'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Upload, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function CreateCampaignPage() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [formData, setFormData] = React.useState({
    name: '',
    description: '',
    placeholders: '',
  });
  const [templateFile, setTemplateFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setTemplateFile(e.target.files[0]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!formData.name) {
        throw new Error('Campaign name is required');
      }
      if (!templateFile) {
        throw new Error('Template PDF is required');
      }
      if (!formData.placeholders) {
        throw new Error('At least one placeholder is required');
      }

      // Parse placeholders
      const placeholders = formData.placeholders
        .split(',')
        .map(p => p.trim())
        .filter(p => p);

      // In production, upload file to storage service
      const templatePdfUrl = `/uploads/${templateFile.name}`;

      // Create campaign
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          templatePdfUrl,
          placeholders,
          userId: 'default-user',
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to create campaign');
      }

      const campaign = await res.json();
      router.push(`/campaigns/${campaign.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <Link href="/campaigns" className="inline-flex items-center text-blue-600 hover:text-blue-700 mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Campaigns
          </Link>
          <h1 className="text-3xl font-bold text-slate-900">Create Campaign</h1>
          <p className="text-slate-500 mt-2">Set up a new WeTransfer campaign</p>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-3xl mx-auto px-6 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <Card className="bg-red-50 border-red-200">
              <CardContent className="pt-6">
                <p className="text-red-800">{error}</p>
              </CardContent>
            </Card>
          )}

          {/* Campaign Name */}
          <Card className="bg-white border-slate-200">
            <CardHeader>
              <CardTitle>Campaign Details</CardTitle>
              <CardDescription>Basic information about your campaign</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-900 mb-2">
                  Campaign Name *
                </label>
                <Input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="e.g., Q3 Product Launch"
                  className="bg-white border-slate-300"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-900 mb-2">
                  Description (Optional)
                </label>
                <Textarea
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="Describe the purpose of this campaign"
                  className="bg-white border-slate-300"
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>

          {/* Template Upload */}
          <Card className="bg-white border-slate-200">
            <CardHeader>
              <CardTitle>Template PDF</CardTitle>
              <CardDescription>Upload the PDF template to personalize for each lead</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-slate-400 transition">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  className="hidden"
                  id="pdf-upload"
                  required
                />
                <label htmlFor="pdf-upload" className="cursor-pointer block">
                  <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="font-medium text-slate-900">
                    {templateFile ? templateFile.name : 'Choose PDF file'}
                  </p>
                  <p className="text-sm text-slate-500 mt-1">or drag and drop</p>
                </label>
              </div>
            </CardContent>
          </Card>

          {/* Placeholders */}
          <Card className="bg-white border-slate-200">
            <CardHeader>
              <CardTitle>Placeholders</CardTitle>
              <CardDescription>
                Define placeholders to personalize documents. Use format: email, name, company
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                name="placeholders"
                value={formData.placeholders}
                onChange={handleInputChange}
                placeholder="email, name, company, referenceNumber"
                className="bg-white border-slate-300 font-mono text-sm"
                rows={3}
                required
              />
              <p className="text-xs text-slate-500 mt-2">
                Comma-separated list of placeholder names. These will be replaced with lead data.
              </p>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3">
            <Link href="/campaigns" className="flex-1">
              <Button variant="outline" className="w-full border-slate-300">
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
            >
              {loading ? 'Creating...' : 'Create Campaign'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
