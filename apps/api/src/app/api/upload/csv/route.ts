import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { recordCsvUpload } from '@/lib/campaign-service';

/**
 * POST /api/upload/csv - Parse and validate CSV file
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!file.name.endsWith('.csv')) {
      return NextResponse.json(
        { error: 'File must be a CSV' },
        { status: 400 }
      );
    }

    const text = await file.text();
    const { data, errors } = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });

    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'Failed to parse CSV', details: errors },
        { status: 400 }
      );
    }

    // Validate required fields
    const validLeads = (data as any[]).filter(
      (row: any) => row.email && row.name
    );

    if (validLeads.length === 0) {
      return NextResponse.json(
        { error: 'No valid leads found. Required columns: email, name' },
        { status: 400 }
      );
    }

    recordCsvUpload(file.name, validLeads.length);

    return NextResponse.json({
      count: validLeads.length,
      leads: validLeads,
      sample: validLeads.slice(0, 5),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
