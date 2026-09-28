// @ts-ignore
'use client';

import React, { useEffect } from 'react';

interface CalendlyBookingProps {
  calendlyUrl?: string;
  agencyName?: string;
}

export default function CalendlyBooking({ 
  calendlyUrl = "https://calendly.com", 
  agencyName = "Propel Reality AI" 
}: CalendlyBookingProps) {

  useEffect(() => {
    const head = document.querySelector('head');
    const script = document.createElement('script');
    script.setAttribute('src', 'https://assets.calendly.com/assets/external/widget.js');
    script.setAttribute('async', 'true');
    if (head) {
      head.appendChild(script);
    }
  }, []);

  return (
    <div className="w-full min-h-[650px] flex flex-col items-center justify-center p-4 bg-gray-50 rounded-xl border border-gray-200 shadow-sm">
      <div className="mb-4 text-center">
        <h3 className="text-xl font-bold text-gray-800">Schedule Your Site Visit</h3>
        <p className="text-sm text-gray-500">Book a private property showing with {agencyName}</p>
      </div>

      <div 
        className="calendly-inline-widget w-full h-[600px] min-w-[320px]" 
        data-url={calendlyUrl}
      />
    </div>
  );
}

