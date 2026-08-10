'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Play, Square, RefreshCw, AlertCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: string;
  totalLeads: number;
  processedLeads: number;
  successLeads: number;
  failedLeads: number;
  leads: Lead[];
  logs: CampaignLog[];
}

interface Lead {
  id: string;
  email: string;
  name: string;
  status: string;
  sentAt?: string;
  errorMessage?: string;
}

interface CampaignLog {
  id: string;
  action: string;
  status: string;
  details?: string;
  createdAt: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary?: {
    totalLeads: number;
    pendingLeads: number;
    status: string;
    placeholders: string[];
  };
}

export default function CampaignDetailPage({ params }: { params: { id: string } }) {
  const [campaign, setCampaign] = React.useState<Campaign | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [isStarting, setIsStarting] = React.useState(false);
  const [isStopping, setIsStopping] = React.useState(false);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = React.useState<string[]>([]);
  const [systemMessage, setSystemMessage] = React.useState('');
  const logsEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    fetchCampaign();
    const interval = setInterval(fetchCampaign, 2000);
    return () => clearInterval(interval);
  }, [params.id]);

  React.useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [campaign?.logs]);

  async function fetchCampaign() {
    try {
      const res = await fetch(`/api/campaigns/${params.id}`);
      if (res.ok) {
        const data = await res.json();
        setCampaign(data);
      }
    } catch (error) {
      console.error('Failed to fetch campaign:', error);
    } finally {
      setLoading(false);
    }
  }

  async function validateCampaign() {
    try {
      const res = await fetch(`/api/campaigns/${params.id}/validate`);
      const result: ValidationResult = await res.json();

      setValidationErrors(result.errors);
      setValidationWarnings(result.warnings);

      if (result.valid) {
        setSystemMessage('✅ Campaign validation passed. Ready to start.');
      } else {
        setSystemMessage('❌ Campaign validation failed. Please fix the errors below.');
      }

      return result.valid;
    } catch (error) {
      setSystemMessage('⚠️ Error validating campaign.');
      console.error('Validation error:', error);
      return false;
    }
  }

  async function handleStartCampaign() {
    setValidationErrors([]);
    setValidationWarnings([]);
    setSystemMessage('⏳ Validating campaign...');
    setIsStarting(true);

    try {
      // Validate first
      const isValid = await validateCampaign();

      if (!isValid) {
        setIsStarting(false);
        return;
      }

      setSystemMessage('✅ Validation passed. Starting campaign...');

      // Start campaign
      const res = await fetch(`/api/campaigns/${params.id}/start`, {
        method: 'POST',
      });

      const result = await res.json();

      if (res.ok) {
        setSystemMessage(
          `🚀 Campaign started! Processing ${result.queued} leads...`
        );
        await fetchCampaign();
      } else {
        setSystemMessage(`❌ Failed to start campaign`);
        setValidationErrors(result.errors || [result.message]);
      }
    } catch (error: any) {
      setSystemMessage(`⚠️ Error: ${error.message}`);
    } finally {
      setIsStarting(false);
    }
  }

  async function handleStopCampaign() {
    if (!confirm('Are you sure you want to stop this campaign?')) {
      return;
    }

    setIsStopping(true);
    setSystemMessage('⏳ Stopping campaign...');

    try {
      const res = await fetch(`/api/campaigns/${params.id}/stop`, {
        method: 'POST',
      });

      const result = await res.json();

      if (res.ok) {
        setSystemMessage(`⏹️ Campaign stopped. ${result.jobsStopped} pending jobs cancelled.`);
        await fetchCampaign();
      } else {
        setSystemMessage(`❌ Failed to stop campaign`);
      }
    } catch (error: any) {
      setSystemMessage(`⚠️ Error: ${error.message}`);
    } finally {
      setIsStopping(false);
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading campaign...</div>;
  }

  if (!campaign) {
    return <div className="text-center py-12">Campaign not found</div>;
  }

  const successRate =
    campaign.totalLeads > 0
      ? Math.round((campaign.successLeads / campaign.totalLeads) * 100)
      : 0;

  const processingCount =
    campaign.processedLeads -
    campaign.successLeads -
    campaign.failedLeads;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <Link href="/campaigns" className="inline-flex items-center text-blue-600 hover:text-blue-700 mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Campaigns
          </Link>
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">{campaign.name}</h1>
              {campaign.description && (
                <p className="text-slate-500 mt-2">{campaign.description}</p>
              )}
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              {campaign.status === 'draft' ? (
                <Button
                  onClick={handleStartCampaign}
                  disabled={isStarting}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Play className="w-4 h-4 mr-2" />
                  {isStarting ? 'Starting...' : 'Start Campaign'}
                </Button>
              ) : campaign.status === 'active' ? (
                <Button
                  onClick={handleStopCampaign}
                  disabled={isStopping}
                  variant="destructive"
                >
                  <Square className="w-4 h-4 mr-2" />
                  {isStopping ? 'Stopping...' : 'Stop Campaign'}
                </Button>
              ) : campaign.status === 'paused' ? (
                <Button
                  onClick={handleStartCampaign}
                  disabled={isStarting}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Play className="w-4 h-4 mr-2" />
                  {isStarting ? 'Resuming...' : 'Resume Campaign'}
                </Button>
              ) : null}
              <Button
                onClick={fetchCampaign}
                variant="outline"
                className="border-slate-300"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* System Message */}
        {systemMessage && (
          <Alert
            className={
              systemMessage.includes('❌')
                ? 'bg-red-50 border-red-200'
                : systemMessage.includes('✅')
                ? 'bg-green-50 border-green-200'
                : systemMessage.includes('🚀')
                ? 'bg-blue-50 border-blue-200'
                : 'bg-yellow-50 border-yellow-200'
            }
          >
            <Info className="w-4 h-4" />
            <AlertDescription className="ml-2">{systemMessage}</AlertDescription>
          </Alert>
        )}

        {/* Validation Errors */}
        {validationErrors.length > 0 && (
          <Alert className="bg-red-50 border-red-200">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="ml-2">
              <p className="font-semibold text-red-800 mb-2">❌ Validation Errors:</p>
              <ul className="list-disc list-inside space-y-1 text-red-700">
                {validationErrors.map((error, idx) => (
                  <li key={idx}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Validation Warnings */}
        {validationWarnings.length > 0 && (
          <Alert className="bg-yellow-50 border-yellow-200">
            <AlertCircle className="w-4 h-4 text-yellow-600" />
            <AlertDescription className="ml-2">
              <p className="font-semibold text-yellow-800 mb-2">⚠️ Warnings:</p>
              <ul className="list-disc list-inside space-y-1 text-yellow-700">
                {validationWarnings.map((warning, idx) => (
                  <li key={idx}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Stats */}
        <div className="grid md:grid-cols-5 gap-4">
          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge
                className={
                  campaign.status === 'active'
                    ? 'bg-green-100 text-green-800'
                    : campaign.status === 'paused'
                    ? 'bg-yellow-100 text-yellow-800'
                    : campaign.status === 'completed'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-slate-100 text-slate-800'
                }
              >
                {campaign.status}
              </Badge>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Leads</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{campaign.totalLeads}</p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Sent</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">{campaign.successLeads}</p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Processing</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-blue-600">{processingCount}</p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Success Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-slate-900">{successRate}%</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Card className="bg-white border-slate-200">
          <CardHeader>
            <CardTitle>Campaign Details</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="logs" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="logs">Activity Logs</TabsTrigger>
                <TabsTrigger value="leads">Leads ({campaign.leads.length})</TabsTrigger>
              </TabsList>

              {/* Logs Tab */}
              <TabsContent value="logs" className="space-y-3 mt-6">
                {campaign.logs.length === 0 ? (
                  <p className="text-slate-500 text-center py-8">No activity yet</p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {campaign.logs.map((log) => (
                      <div key={log.id} className="border border-slate-200 rounded p-3 bg-slate-50">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium text-slate-900">{log.action}</p>
                            <p className="text-xs text-slate-500">
                              {new Date(log.createdAt).toLocaleString()}
                            </p>
                          </div>
                          <Badge
                            className={
                              log.status === 'success'
                                ? 'bg-green-100 text-green-800'
                                : log.status === 'error'
                                ? 'bg-red-100 text-red-800'
                                : log.status === 'warning'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-blue-100 text-blue-800'
                            }
                          >
                            {log.status}
                          </Badge>
                        </div>
                        {log.details && (
                          <p className="text-xs text-slate-600 mt-2 font-mono bg-white p-2 rounded border border-slate-200">
                            {log.details}
                          </p>
                        )}
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </TabsContent>

              {/* Leads Tab */}
              <TabsContent value="leads" className="space-y-4 mt-6">
                {campaign.leads.length === 0 ? (
                  <p className="text-slate-500 text-center py-8">No leads imported yet</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50">
                        <tr>
                          <th className="text-left py-3 px-4 font-medium">Email</th>
                          <th className="text-left py-3 px-4 font-medium">Name</th>
                          <th className="text-left py-3 px-4 font-medium">Company</th>
                          <th className="text-left py-3 px-4 font-medium">Status</th>
                          <th className="text-left py-3 px-4 font-medium">Sent</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaign.leads.map((lead) => (
                          <tr key={lead.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-3 px-4 text-blue-600">{lead.email}</td>
                            <td className="py-3 px-4">{lead.name}</td>
                            <td className="py-3 px-4 text-slate-600">-</td>
                            <td className="py-3 px-4">
                              <Badge
                                className={
                                  lead.status === 'sent'
                                    ? 'bg-green-100 text-green-800'
                                    : lead.status === 'processing'
                                    ? 'bg-blue-100 text-blue-800'
                                    : lead.status === 'failed'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-slate-100 text-slate-800'
                                }
                              >
                                {lead.status}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-slate-500">
                              {lead.sentAt ? new Date(lead.sentAt).toLocaleDateString() : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
