'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Plus, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: string;
  totalLeads: number;
  processedLeads: number;
  successLeads: number;
  failedLeads: number;
  createdAt: string;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    fetchCampaigns();
  }, []);

  async function fetchCampaigns() {
    try {
      setLoading(true);
      const res = await fetch('/api/campaigns');
      const data = await res.json();
      setCampaigns(data);
    } catch (error) {
      console.error('Failed to fetch campaigns:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredCampaigns = campaigns.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'completed':
        return 'bg-blue-100 text-blue-800';
      case 'paused':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Campaigns</h1>
              <p className="text-slate-500 mt-2">Manage all your WeTransfer campaigns</p>
            </div>
            <Link href="/campaigns/create">
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                New Campaign
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search campaigns..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-white border-slate-200"
            />
          </div>
        </div>

        {/* Campaigns Grid */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-500">Loading campaigns...</p>
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <Card className="bg-white border-slate-200 text-center py-12">
            <CardContent>
              <p className="text-slate-500 mb-4">No campaigns found</p>
              <Link href="/campaigns/create">
                <Button className="bg-blue-600 hover:bg-blue-700">
                  Create Your First Campaign
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCampaigns.map((campaign) => {
              const successRate = campaign.totalLeads > 0
                ? Math.round((campaign.successLeads / campaign.totalLeads) * 100)
                : 0;

              return (
                <Link key={campaign.id} href={`/campaigns/${campaign.id}`}>
                  <Card className="bg-white border-slate-200 hover:border-blue-300 hover:shadow-md transition cursor-pointer h-full">
                    <CardHeader>
                      <div className="flex justify-between items-start mb-2">
                        <CardTitle className="text-lg">{campaign.name}</CardTitle>
                        <Badge className={getStatusColor(campaign.status)}>
                          {campaign.status}
                        </Badge>
                      </div>
                      {campaign.description && (
                        <CardDescription className="line-clamp-2">
                          {campaign.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="bg-slate-50 p-3 rounded">
                          <p className="text-slate-500 text-xs">Total Leads</p>
                          <p className="font-bold text-slate-900">{campaign.totalLeads}</p>
                        </div>
                        <div className="bg-green-50 p-3 rounded">
                          <p className="text-slate-500 text-xs">Sent</p>
                          <p className="font-bold text-green-600">{campaign.successLeads}</p>
                        </div>
                        <div className="bg-slate-50 p-3 rounded">
                          <p className="text-slate-500 text-xs">Processing</p>
                          <p className="font-bold text-slate-900">{campaign.processedLeads - campaign.successLeads - campaign.failedLeads}</p>
                        </div>
                        <div className="bg-red-50 p-3 rounded">
                          <p className="text-slate-500 text-xs">Failed</p>
                          <p className="font-bold text-red-600">{campaign.failedLeads}</p>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div>
                        <p className="text-xs text-slate-500 mb-2">Success Rate: {successRate}%</p>
                        <div className="w-full bg-slate-200 rounded-full h-2">
                          <div
                            className="bg-green-500 h-2 rounded-full transition-all"
                            style={{ width: `${successRate}%` }}
                          />
                        </div>
                      </div>

                      <div className="pt-2">
                        <Button
                          variant="ghost"
                          className="w-full justify-between text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        >
                          View Details
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
