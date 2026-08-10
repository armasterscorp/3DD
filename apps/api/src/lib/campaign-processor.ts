import { prisma } from '@/lib/prisma';
import { campaignQueue } from '@/lib/queue';
import { generateTemporaryEmail } from '@/lib/temp-email';
import { createWeTransferTransfer } from '@/lib/wetransfer';
import { sendEmail } from '@/lib/email';
import { generatePersonalizedPdf } from '@/lib/pdf';

export async function processCampaignLead(
  campaignId: string,
  leadId: string,
  email: string,
  name: string,
  company: string | undefined,
  referenceNumber: string | undefined,
  customFields: Record<string, any> | undefined,
  templatePdfUrl: string,
  placeholders: string[]
): Promise<{ success: boolean; weTransferId?: string; error?: string }> {
  try {
    // Update lead status to processing
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'processing' },
    });

    await logAction(
      campaignId,
      leadId,
      'started_processing',
      'success'
    );

    // Step 1: Generate temporary email
    const tempEmail = await generateTemporaryEmail();
    await prisma.temporaryEmail.create({
      data: {
        email: tempEmail,
        leadId,
        campaignId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      },
    });

    await logAction(
      campaignId,
      leadId,
      'created_temp_email',
      'success',
      { tempEmail }
    );

    // Step 2: Generate personalized PDF
    const placeholderMap: Record<string, string> = {
      email,
      name,
      company: company || 'N/A',
      referenceNumber: referenceNumber || 'N/A',
      ...customFields,
    };

    const pdfBuffer = await generatePersonalizedPdf(
      templatePdfUrl,
      placeholderMap,
      `/tmp/${leadId}.pdf`
    );

    await logAction(
      campaignId,
      leadId,
      'generated_pdf',
      'success',
      { size: pdfBuffer.length }
    );

    // Step 3: Upload to WeTransfer
    const weTransferResult = await createWeTransferTransfer(
      `${name}_document.pdf`,
      pdfBuffer,
      email,
      `Hi ${name}, here's your personalized document from 3D Suite`
    );

    if (!weTransferResult.success) {
      throw new Error(weTransferResult.error);
    }

    await logAction(
      campaignId,
      leadId,
      'uploaded_to_wetransfer',
      'success',
      { downloadUrl: weTransferResult.downloadUrl }
    );

    // Step 4: Send email with WeTransfer link
    const emailResult = await sendEmail(
      email,
      `Your Personalized Document - ${name}`,
      `
        <h2>Hello ${name},</h2>
        <p>Your personalized document is ready for download.</p>
        <p><a href="${weTransferResult.downloadUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none;">Download Now</a></p>
        <p>This link will expire in 7 days.</p>
      `
    );

    if (!emailResult.success) {
      throw new Error(`Failed to send email: ${emailResult.error}`);
    }

    // Step 5: Update lead with success
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        status: 'sent',
        weTransferId: weTransferResult.downloadUrl,
        tempEmail,
        sentAt: new Date(),
      },
    });

    // Update campaign stats
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        successLeads: { increment: 1 },
        processedLeads: { increment: 1 },
      },
    });

    await logAction(
      campaignId,
      leadId,
      'sent_email',
      'success',
      { email }
    );

    return {
      success: true,
      weTransferId: weTransferResult.downloadUrl,
    };
  } catch (error: any) {
    console.error(`Error processing lead ${leadId}:`, error);

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        status: 'failed',
        errorMessage: error.message,
      },
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        failedLeads: { increment: 1 },
        processedLeads: { increment: 1 },
      },
    });

    await logAction(
      campaignId,
      leadId,
      'process_failed',
      'error',
      { error: error.message }
    );

    return {
      success: false,
      error: error.message,
    };
  }
}

async function logAction(
  campaignId: string,
  leadId: string,
  action: string,
  status: 'success' | 'error' | 'warning' | 'info',
  details?: Record<string, any>
) {
  await prisma.campaignLog.create({
    data: {
      campaignId,
      leadId,
      action,
      status,
      details: details ? JSON.stringify(details) : undefined,
    },
  });
}
