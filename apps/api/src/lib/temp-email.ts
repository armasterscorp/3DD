/**
 * Temporary email service integration
 * Supports: tempmail.com, guerrillamail.com, etc.
 */

interface TemporaryEmailProvider {
  generateEmail(): Promise<string>;
  deleteEmail(email: string): Promise<void>;
}

class TempMailProvider implements TemporaryEmailProvider {
  async generateEmail(): Promise<string> {
    try {
      const response = await fetch('https://api.tempmail.com/new');
      const data = await response.json();
      return data.email;
    } catch (error) {
      throw new Error(`Failed to generate temp email: ${error}`);
    }
  }

  async deleteEmail(email: string): Promise<void> {
    // TempMail automatically deletes emails
  }
}

class GuerrillMailProvider implements TemporaryEmailProvider {
  async generateEmail(): Promise<string> {
    try {
      const response = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address');
      const data = await response.json();
      return data.email_address;
    } catch (error) {
      throw new Error(`Failed to generate temp email: ${error}`);
    }
  }

  async deleteEmail(email: string): Promise<void> {
    // GuerrilaMail automatically deletes emails
  }
}

function getProvider(providerName: string): TemporaryEmailProvider {
  switch (providerName.toLowerCase()) {
    case 'tempmail':
      return new TempMailProvider();
    case 'guerrillamail':
      return new GuerrillMailProvider();
    default:
      return new TempMailProvider();
  }
}

export async function generateTemporaryEmail(): Promise<string> {
  const provider = getProvider(process.env.TEMP_EMAIL_PROVIDER || 'tempmail');
  return provider.generateEmail();
}
