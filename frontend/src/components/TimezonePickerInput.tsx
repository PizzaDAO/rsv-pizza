import React, { useState, useRef, useEffect } from 'react';

interface TimezonePickerInputProps {
  value: string; // IANA timezone like "America/New_York"
  onChange: (value: string) => void;
}

// Popular timezones to show first
const POPULAR_TIMEZONES = [
  'America/Los_Angeles',
  'America/Chicago',
  'America/Toronto',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
];

// Get all IANA timezones
const ALL_TIMEZONES = Intl.supportedValuesOf('timeZone');

export function TimezonePickerInput({ value, onChange }: TimezonePickerInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Format timezone for display
  const formatTimezone = (tz: string) => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset'
    });
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');
    const offset = offsetPart?.value || '';

    // Get city name from timezone
    const city = tz.split('/').pop()?.replace(/_/g, ' ') || tz;

    return { offset, city, fullName: tz };
  };

  const getTimezoneDisplay = () => {
    if (!value) return { offset: '', city: '' };
    return formatTimezone(value);
  };

  // Filter timezones based on search
  const filterTimezones = (timezones: string[]) => {
    if (!searchText) return timezones;
    const search = searchText.toLowerCase();
    return timezones.filter(tz => {
      const { city, offset } = formatTimezone(tz);
      return (
        city.toLowerCase().includes(search) ||
        tz.toLowerCase().includes(search) ||
        offset.toLowerCase().includes(search)
      );
    });
  };

  const filteredPopular = filterTimezones(POPULAR_TIMEZONES);
  const filteredAll = filterTimezones(ALL_TIMEZONES.filter(tz => !POPULAR_TIMEZONES.includes(tz)));

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchText('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectTimezone = (tz: string) => {
    onChange(tz);
    setIsOpen(false);
    setSearchText('');
  };

  const display = getTimezoneDisplay();

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-xs text-white/50 hover:text-white/70 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div className="text-right">
          <div className="font-medium">{display.offset}</div>
          <div>{display.city}</div>
        </div>
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-80 bg-[#1a1a1a] border border-white/20 rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Search Input */}
          <div className="p-3 border-b border-white/10">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search for a timezone"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#4285f4]"
              autoFocus
            />
          </div>

          {/* Timezone List */}
          <div className="max-h-96 overflow-y-auto">
            {/* Popular Timezones */}
            {filteredPopular.length > 0 && (
              <div>
                <div className="px-3 py-2 text-xs font-medium text-white/40 bg-white/5">
                  Popular Timezones
                </div>
                {filteredPopular.map((tz) => {
                  const { offset, city } = formatTimezone(tz);
                  const isSelected = tz === value;
                  return (
                    <button
                      key={tz}
                      type="button"
                      onClick={() => handleSelectTimezone(tz)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                        isSelected
                          ? 'bg-[#4285f4] text-white'
                          : 'text-white/80 hover:bg-white/10'
                      }`}
                    >
                      <span>{city}</span>
                      <span className="text-xs text-white/50">{offset}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* All Timezones */}
            {filteredAll.length > 0 && (
              <div>
                <div className="px-3 py-2 text-xs font-medium text-white/40 bg-white/5 sticky top-0">
                  All Timezones
                </div>
                {filteredAll.map((tz) => {
                  const { offset, city } = formatTimezone(tz);
                  const isSelected = tz === value;
                  return (
                    <button
                      key={tz}
                      type="button"
                      onClick={() => handleSelectTimezone(tz)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                        isSelected
                          ? 'bg-[#4285f4] text-white'
                          : 'text-white/80 hover:bg-white/10'
                      }`}
                    >
                      <span>{city}</span>
                      <span className="text-xs text-white/50">{offset}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {filteredPopular.length === 0 && filteredAll.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-white/50">
                No timezones found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
