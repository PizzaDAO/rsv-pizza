import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Monitor, Loader2, AlertCircle, Map, Link, MapPin, X } from 'lucide-react';
import { Display } from '../../types';
import { getPartyDisplays, createDisplay, updateDisplay, deleteDisplay } from '../../lib/api';
import { DisplayCard } from './DisplayCard';
import { DisplayForm, DisplayFormData } from './DisplayForm';
import { IconInput } from '../IconInput';

interface FloorplanPin {
  displayId: string;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
}

interface FloorplanData {
  url: string;
  pins: FloorplanPin[];
}

interface DisplaysWidgetProps {
  partyId: string;
}

export function DisplaysWidget({ partyId }: DisplaysWidgetProps) {
  const [displays, setDisplays] = useState<Display[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingDisplay, setEditingDisplay] = useState<Display | null>(null);
  const [saving, setSaving] = useState(false);

  // Floorplan state
  const [floorplanUrl, setFloorplanUrl] = useState('');
  const [floorplanInput, setFloorplanInput] = useState('');
  const [showFloorplanInput, setShowFloorplanInput] = useState(false);
  const [pins, setPins] = useState<FloorplanPin[]>([]);

  // Pin placement state
  const [pendingClick, setPendingClick] = useState<{ x: number; y: number } | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [draggingPinId, setDraggingPinId] = useState<string | null>(null);
  const floorplanRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const loadDisplays = useCallback(async () => {
    try {
      setLoadError(null);
      const result = await getPartyDisplays(partyId);
      if (result) {
        setDisplays(result.displays);
      }
    } catch (err) {
      setLoadError('Failed to load displays');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    loadDisplays();
  }, [loadDisplays]);

  // Load floorplan data from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`floorplan-${partyId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (typeof parsed === 'object' && parsed.url) {
          // New format: { url, pins }
          setFloorplanUrl(parsed.url);
          setFloorplanInput(parsed.url);
          setPins(parsed.pins || []);
        } else if (typeof parsed === 'string') {
          // Legacy format: just a URL string
          setFloorplanUrl(parsed);
          setFloorplanInput(parsed);
          setPins([]);
        }
      } catch {
        // Legacy format: plain string (not JSON)
        setFloorplanUrl(saved);
        setFloorplanInput(saved);
        setPins([]);
      }
    }
  }, [partyId]);

  // Save floorplan data to localStorage whenever pins or URL change
  const saveFloorplanData = useCallback((url: string, pinData: FloorplanPin[]) => {
    if (url) {
      const data: FloorplanData = { url, pins: pinData };
      localStorage.setItem(`floorplan-${partyId}`, JSON.stringify(data));
    } else {
      localStorage.removeItem(`floorplan-${partyId}`);
    }
  }, [partyId]);

  // Close popovers when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPendingClick(null);
        setSelectedPinId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCreate = () => {
    setEditingDisplay(null);
    setShowForm(true);
  };

  const handleEdit = (display: Display) => {
    setEditingDisplay(display);
    setShowForm(true);
  };

  const handleSave = async (data: DisplayFormData) => {
    setSaving(true);
    setSaveError(null);
    try {
      if (editingDisplay) {
        const result = await updateDisplay(partyId, editingDisplay.id, data);
        if (result) {
          setDisplays(displays.map(d => d.id === editingDisplay.id ? result.display : d));
          setShowForm(false);
          setEditingDisplay(null);
        } else {
          setSaveError('Failed to update display. Please try again.');
        }
      } else {
        const result = await createDisplay(partyId, data);
        if (result) {
          setDisplays([...displays, result.display]);
          setShowForm(false);
          setEditingDisplay(null);
        } else {
          setSaveError('Failed to create display. Please try again.');
        }
      }
    } catch (err) {
      console.error('Error saving display:', err);
      setSaveError('Failed to save display. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (display: Display) => {
    if (!confirm(`Delete "${display.name}"? This cannot be undone.`)) return;

    try {
      const success = await deleteDisplay(partyId, display.id);
      if (success) {
        setDisplays(displays.filter(d => d.id !== display.id));
        // Also remove any pin for this display
        const newPins = pins.filter(p => p.displayId !== display.id);
        setPins(newPins);
        saveFloorplanData(floorplanUrl, newPins);
      }
    } catch (err) {
      console.error('Error deleting display:', err);
    }
  };

  const handleToggleActive = async (display: Display) => {
    try {
      const result = await updateDisplay(partyId, display.id, { isActive: !display.isActive });
      if (result) {
        setDisplays(displays.map(d => d.id === display.id ? result.display : d));
      }
    } catch (err) {
      console.error('Error toggling display:', err);
    }
  };

  const handleSaveFloorplan = () => {
    const url = floorplanInput.trim();
    if (url) {
      setFloorplanUrl(url);
      saveFloorplanData(url, pins);
    } else {
      setFloorplanUrl('');
      setPins([]);
      localStorage.removeItem(`floorplan-${partyId}`);
    }
    setShowFloorplanInput(false);
  };

  // Get displays that haven't been placed on the floorplan yet
  const unplacedDisplays = displays.filter(d => !pins.some(p => p.displayId === d.id));

  // Handle click on the floorplan image to place a pin
  const handleFloorplanClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't handle if we're dragging or clicking on a pin/popover
    if (draggingPinId) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-pin]') || target.closest('[data-popover]')) return;

    // Close any open popover first
    if (pendingClick || selectedPinId) {
      setPendingClick(null);
      setSelectedPinId(null);
      return;
    }

    // No unplaced displays - nothing to place
    if (unplacedDisplays.length === 0) return;

    const rect = floorplanRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setPendingClick({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
    setSelectedPinId(null);
  };

  // Place a display at the pending click location
  const handlePlaceDisplay = (displayId: string) => {
    if (!pendingClick) return;
    const newPin: FloorplanPin = { displayId, x: pendingClick.x, y: pendingClick.y };
    const newPins = [...pins, newPin];
    setPins(newPins);
    saveFloorplanData(floorplanUrl, newPins);
    setPendingClick(null);
  };

  // Remove a pin from the floorplan
  const handleRemovePin = (displayId: string) => {
    const newPins = pins.filter(p => p.displayId !== displayId);
    setPins(newPins);
    saveFloorplanData(floorplanUrl, newPins);
    setSelectedPinId(null);
  };

  // Handle pin click to show remove option
  const handlePinClick = (e: React.MouseEvent, displayId: string) => {
    e.stopPropagation();
    if (draggingPinId) return;
    setSelectedPinId(selectedPinId === displayId ? null : displayId);
    setPendingClick(null);
  };

  // Drag handling
  const handleDragStart = (e: React.MouseEvent, displayId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingPinId(displayId);
    setSelectedPinId(null);
    setPendingClick(null);

    const rect = floorplanRef.current?.getBoundingClientRect();
    if (!rect) return;

    const handleDragMove = (moveEvent: MouseEvent) => {
      const x = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      const y = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      const clampedX = Math.max(0, Math.min(100, x));
      const clampedY = Math.max(0, Math.min(100, y));

      setPins(prev => prev.map(p =>
        p.displayId === displayId ? { ...p, x: clampedX, y: clampedY } : p
      ));
    };

    const handleDragEnd = () => {
      setDraggingPinId(null);
      // Save after drag ends
      setPins(prev => {
        saveFloorplanData(floorplanUrl, prev);
        return prev;
      });
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
    };

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  };

  // Touch drag handling for mobile
  const handleTouchStart = (e: React.TouchEvent, displayId: string) => {
    e.stopPropagation();
    setDraggingPinId(displayId);
    setSelectedPinId(null);
    setPendingClick(null);

    const rect = floorplanRef.current?.getBoundingClientRect();
    if (!rect) return;

    const handleTouchMove = (moveEvent: TouchEvent) => {
      moveEvent.preventDefault();
      const touch = moveEvent.touches[0];
      const x = ((touch.clientX - rect.left) / rect.width) * 100;
      const y = ((touch.clientY - rect.top) / rect.height) * 100;
      const clampedX = Math.max(0, Math.min(100, x));
      const clampedY = Math.max(0, Math.min(100, y));

      setPins(prev => prev.map(p =>
        p.displayId === displayId ? { ...p, x: clampedX, y: clampedY } : p
      ));
    };

    const handleTouchEnd = () => {
      setDraggingPinId(null);
      setPins(prev => {
        saveFloorplanData(floorplanUrl, prev);
        return prev;
      });
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  };

  // Get display name by ID
  const getDisplayName = (displayId: string): string => {
    const display = displays.find(d => d.id === displayId);
    return display?.name || 'Unknown';
  };

  // Check if a display is active
  const isDisplayActive = (displayId: string): boolean => {
    const display = displays.find(d => d.id === displayId);
    return display?.isActive ?? false;
  };

  // Compute popover position to keep it within the floorplan bounds
  const getPopoverStyle = (xPercent: number, yPercent: number): React.CSSProperties => {
    const style: React.CSSProperties = {
      position: 'absolute',
      zIndex: 50,
    };

    // Position below the click point by default, flip above if near bottom
    if (yPercent > 70) {
      style.bottom = `${100 - yPercent + 3}%`;
    } else {
      style.top = `${yPercent + 3}%`;
    }

    // Center horizontally, but clamp to edges
    if (xPercent < 20) {
      style.left = '2%';
    } else if (xPercent > 80) {
      style.right = '2%';
    } else {
      style.left = `${xPercent}%`;
      style.transform = 'translateX(-50%)';
    }

    return style;
  };

  if (loading) {
    return (
      <div className="card p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card p-8">
        <div className="flex flex-col items-center text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
          <p className="text-red-400">{loadError}</p>
          <button
            onClick={loadDisplays}
            className="mt-4 text-sm text-[#ff393a] hover:underline"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Monitor className="text-[#ff393a]" size={20} />
          <div>
            <h3 className="font-medium text-theme-text">Displays</h3>
            <p className="text-sm text-theme-text-muted">
              Create screens for TVs, projectors, and tablets
            </p>
          </div>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 bg-[#ff393a] hover:bg-[#ff393a]/90 text-white rounded-lg transition-colors"
        >
          <Plus size={18} />
          New Display
        </button>
      </div>

      {/* Floorplan Section */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Map className="text-theme-text-muted" size={18} />
            <h3 className="font-medium text-theme-text text-sm">Venue Floorplan</h3>
          </div>
          <button
            onClick={() => setShowFloorplanInput(!showFloorplanInput)}
            className="text-xs text-[#ff393a] hover:underline"
          >
            {floorplanUrl ? 'Change' : 'Add Floorplan'}
          </button>
        </div>

        {showFloorplanInput && (
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1">
              <IconInput
                icon={Link}
                type="url"
                value={floorplanInput}
                onChange={(e) => setFloorplanInput(e.target.value)}
                placeholder="Floorplan image URL"
              />
            </div>
            <button
              onClick={handleSaveFloorplan}
              className="px-3 py-2 bg-[#ff393a] hover:bg-[#ff393a]/90 text-white text-sm rounded-lg transition-colors whitespace-nowrap"
            >
              Save
            </button>
          </div>
        )}

        {floorplanUrl ? (
          <div
            ref={floorplanRef}
            className="relative rounded-lg overflow-hidden border border-theme-stroke cursor-crosshair select-none"
            onClick={handleFloorplanClick}
          >
            <img
              src={floorplanUrl}
              alt="Venue Floorplan"
              className="w-full max-h-[400px] object-contain bg-black/30 pointer-events-none"
              draggable={false}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />

            {/* "Click to place" hint when no pins are placed and there are displays */}
            {pins.length === 0 && displays.length > 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/50 backdrop-blur-sm px-4 py-2 rounded-lg border border-theme-stroke">
                  <p className="text-theme-text-secondary text-sm flex items-center gap-2">
                    <MapPin size={14} className="text-[#ff393a]" />
                    Click to place displays
                  </p>
                </div>
              </div>
            )}

            {/* Placed pins */}
            {pins.map((pin) => (
              <div
                key={pin.displayId}
                data-pin="true"
                className="absolute group"
                style={{
                  left: `${pin.x}%`,
                  top: `${pin.y}%`,
                  transform: 'translate(-50%, -100%)',
                  zIndex: draggingPinId === pin.displayId ? 40 : selectedPinId === pin.displayId ? 30 : 20,
                }}
              >
                {/* Drag handle + pin icon */}
                <div
                  className={`flex flex-col items-center ${draggingPinId === pin.displayId ? 'scale-110' : ''} transition-transform`}
                >
                  {/* Pin marker */}
                  <div
                    className="relative cursor-grab active:cursor-grabbing"
                    onMouseDown={(e) => handleDragStart(e, pin.displayId)}
                    onTouchStart={(e) => handleTouchStart(e, pin.displayId)}
                    onClick={(e) => handlePinClick(e, pin.displayId)}
                  >
                    <MapPin
                      size={28}
                      className="drop-shadow-lg"
                      fill={isDisplayActive(pin.displayId) ? '#ff393a' : 'rgba(255,255,255,0.3)'}
                      color={isDisplayActive(pin.displayId) ? '#cc2e2f' : 'rgba(255,255,255,0.5)'}
                    />
                  </div>

                  {/* Label below pin */}
                  <div
                    className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium shadow-lg whitespace-nowrap
                      ${isDisplayActive(pin.displayId)
                        ? 'bg-black/80 text-theme-text'
                        : 'bg-black/60 text-theme-text-secondary'
                      }
                      ${selectedPinId === pin.displayId ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                      transition-opacity`}
                  >
                    {getDisplayName(pin.displayId)}
                  </div>
                </div>

                {/* Remove popover on pin click */}
                {selectedPinId === pin.displayId && (
                  <div
                    data-popover="true"
                    ref={popoverRef}
                    className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50"
                  >
                    <div className="bg-black/90 backdrop-blur border border-theme-stroke rounded-lg shadow-xl p-2 min-w-[120px]">
                      <div className="text-xs text-theme-text-secondary px-2 py-1 truncate max-w-[150px]">
                        {getDisplayName(pin.displayId)}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemovePin(pin.displayId);
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-red-400 hover:bg-theme-surface rounded transition-colors"
                      >
                        <X size={12} />
                        Remove from floorplan
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Pending click - display picker popover */}
            {pendingClick && unplacedDisplays.length > 0 && (
              <div
                data-popover="true"
                ref={popoverRef}
                style={getPopoverStyle(pendingClick.x, pendingClick.y)}
              >
                <div className="bg-black/90 backdrop-blur border border-theme-stroke rounded-lg shadow-xl p-2 min-w-[160px] max-h-[200px] overflow-y-auto">
                  <div className="text-xs text-theme-text-muted px-2 py-1 mb-1">Place a display here</div>
                  {unplacedDisplays.map((d) => (
                    <button
                      key={d.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlaceDisplay(d.id);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-theme-text hover:bg-theme-surface-hover rounded transition-colors text-left"
                    >
                      <MapPin size={14} className="text-[#ff393a] shrink-0" />
                      <span className="truncate">{d.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Crosshair indicator at pending click location */}
            {pendingClick && (
              <div
                className="absolute w-2 h-2 bg-[#ff393a] rounded-full border border-theme-stroke-hover pointer-events-none"
                style={{
                  left: `${pendingClick.x}%`,
                  top: `${pendingClick.y}%`,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 10,
                }}
              />
            )}
          </div>
        ) : (
          <p className="text-xs text-theme-text-faint text-center py-3">
            Add a floorplan image to see where displays are placed
          </p>
        )}

        {/* Pin summary below floorplan */}
        {floorplanUrl && pins.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pins.map((pin) => (
              <span
                key={pin.displayId}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-theme-surface border border-theme-stroke text-theme-text-secondary"
              >
                <MapPin size={10} className="text-[#ff393a]" />
                {getDisplayName(pin.displayId)}
              </span>
            ))}
            {unplacedDisplays.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] text-theme-text-faint">
                +{unplacedDisplays.length} unplaced
              </span>
            )}
          </div>
        )}
      </div>

      {/* Display List */}
      {displays.length === 0 ? (
        <div className="card p-8 text-center">
          <Monitor className="w-12 h-12 text-theme-text-faint mx-auto mb-4" />
          <h3 className="text-lg font-medium text-theme-text mb-2">No displays yet</h3>
          <p className="text-theme-text-muted mb-4">
            Create displays for TVs, projectors, or tablets at your event.
          </p>
          <button
            onClick={handleCreate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#ff393a] hover:bg-[#ff393a]/90 text-white rounded-lg transition-colors"
          >
            <Plus size={18} />
            Create Your First Display
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {displays.map((display) => (
            <DisplayCard
              key={display.id}
              display={display}
              partyId={partyId}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleActive={handleToggleActive}
            />
          ))}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <DisplayForm
          display={editingDisplay}
          onSave={handleSave}
          onClose={() => {
            setShowForm(false);
            setEditingDisplay(null);
            setSaveError(null);
          }}
          isLoading={saving}
          error={saveError}
        />
      )}
    </div>
  );
}
