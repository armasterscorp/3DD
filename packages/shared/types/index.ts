export interface Campaign {
  id: string;
  userId: string;
  name: string;
  description?: string;
  templatePdfUrl: string;
  placeholders: string[];
  status: 'draft' | 'active' | 'completed' | 'paused';
  totalLeads: number;
  processedLeads: number;
  failedLeads: number;
  successLeads: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Lead {
  id: string;
  campaignId: string;
  email: string;
  name: string;
  company?: string;
  referenceNumber?: string;
  customFields?: Record<string, any>;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  weTransferId?: string;
  tempEmail?: string;
  errorMessage?: string;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignLog {
  id: string;
  campaignId: string;
  leadId?: string;
  action: string;
  details?: string;
  status: 'success' | 'error' | 'warning' | 'info';
  createdAt: Date;
}

export interface CreateCampaignRequest {
  name: string;
  description?: string;
  templatePdfUrl: string;
  placeholders: string[];
}

export interface ImportLeadsRequest {
  campaignId: string;
  leads: Array<{
    email: string;
    name: string;
    company?: string;
    referenceNumber?: string;
    [key: string]: any;
  }>;
}

export interface SendCampaignRequest {
  campaignId: string;
}

export interface WeTransferResponse {
  success: boolean;
  downloadLink?: string;
  error?: string;
  tempEmail?: string;
}
