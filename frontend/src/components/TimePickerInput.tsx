import React, { useState, useRef, useEffect } from 'react';

interface TimePickerInputProps {
  value: string; // 24-hour format "HH:MM"
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function TimePickerInput({ value, onChange, placeholder = '12:00 PM', className }: TimePickerInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Generate time options in 30-minute intervals
  const generateTimeOptions = () => {
    const options: string[] = [];
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const time24 = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        options.push(time24);
      }
    }
    return options;
  };

  const timeOptions = generateTimeOptions();

  // Convert 24-hour to 12-hour format
  const format12Hour = (time24: string) => {
    if (!time24) return '';
    const [hours, minutes] = time24.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  // Convert 12-hour to 24-hour format
  const parse12Hour = (time12: string): string | null => {
    const match = time12.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return null;

    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toUpperCase();

    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  };

  // Filter options based on search text
  const filteredOptions = searchText
    ? timeOptions.filter(time => format12Hour(time).toLowerCase().includes(searchText.toLowerCase()))
    : timeOptions;

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setSearchText(text);
    setIsOpen(true);

    // Try to parse the input
    const parsed = parse12Hour(text);
    if (parsed) {
      onChange(parsed);
    }
  };

  const handleSelectTime = (time24: string) => {
    onChange(time24);
    setIsOpen(false);
    setSearchText('');
  };

  const handleInputClick = () => {
    setIsOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && filteredOptions.length > 0) {
      handleSelectTime(filteredOptions[0]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setSearchText('');
    }
  };

  const displayValue = searchText || format12Hour(value) || placeholder;

  return (
    <div className="relative" ref={dropdownRef}>
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        onChange={handleInputChange}
        onClick={handleInputClick}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className || "w-32 bg-transparent border-none text-white text-sm focus:outline-none focus:ring-0 p-0 cursor-pointer"}
      />

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-32 bg-[#1a1a1a] border border-white/20 rounded-lg shadow-xl max-h-64 overflow-y-auto z-50">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((time24) => {
              const time12 = format12Hour(time24);
              const isSelected = time24 === value;
              return (
                <button
                  key={time24}
                  type="button"
                  onClick={() => handleSelectTime(time24)}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                    isSelected
                      ? 'bg-[#4285f4] text-white font-medium'
                      : 'text-white/80 hover:bg-white/10'
                  }`}
                >
                  {time12}
                </button>
              );
            })
          ) : (
            <div className="px-4 py-2 text-sm text-white/50">No matches</div>
          )}
        </div>
      )}
    </div>
  );
}
