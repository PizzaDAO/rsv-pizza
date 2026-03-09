import React, { useState, useEffect } from 'react';
import { X, Monitor, Image, QrCode, Info, Camera, Upload, Ruler, ScreenShare, Type, Link, Shapes } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import {
  Display,
  DisplayContentType,
  SlideshowConfig,
  QRCodeConfig,
  PhotosConfig,
  EventInfoConfig,
  UploadConfig,
  FloorplanConfig,
} from '../../types';

interface DisplayFormProps {
  display?: Display | null;
  onSave: (data: DisplayFormData) => void;
  onClose: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export interface DisplayFormData {
  name: string;
  contentType: DisplayContentType;
  contentConfig: any;
  rotationInterval: number;
  backgroundColor: string;
  showClock: boolean;
  showEventName: boolean;
}

const contentTypes: { value: DisplayContentType; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'slideshow', label: 'Slideshow', icon: <Image size={20} />, description: 'Google Slides presentation' },
  { value: 'qr_code', label: 'QR Code', icon: <QrCode size={20} />, description: 'RSVP link QR code' },
  { value: 'event_info', label: 'Event Info', icon: <Info size={20} />, description: 'Event details display' },
  { value: 'photos', label: 'Photo Wall', icon: <Camera size={20} />, description: 'Live photo gallery' },
  { value: 'upload', label: 'Upload', icon: <Upload size={20} />, description: 'Image or video upload' },
  { value: 'floorplan', label: 'Floorplan', icon: <Shapes size={20} />, description: 'Venue map with rentals' },
];

const RESOLUTION_PRESETS = [
  { value: '1920x1080', label: '1920x1080 (Full HD)' },
  { value: '3840x2160', label: '3840x2160 (4K)' },
  { value: '1280x720', label: '1280x720 (HD)' },
  { value: '1024x768', label: '1024x768 (XGA)' },
  { value: 'custom', label: 'Custom' },
];

export function DisplayForm({ display, onSave, onClose, isLoading, error }: DisplayFormProps) {
  const [name, setName] = useState(display?.name || '');
  const [contentType, setContentType] = useState<DisplayContentType>(display?.contentType || 'qr_code');
  const [rotationInterval, setRotationInterval] = useState(display?.rotationInterval || 10);
  const [backgroundColor, setBackgroundColor] = useState(display?.backgroundColor || '#000000');
  const [showClock, setShowClock] = useState(display?.showClock || false);
  const [showEventName, setShowEventName] = useState(display?.showEventName ?? true);

  // Display dimensions (stored inside contentConfig for persistence)
  const displayMeta = (display?.contentConfig as any) || {};
  const [physicalWidth, setPhysicalWidth] = useState(displayMeta._physicalWidth || '');
  const [physicalHeight, setPhysicalHeight] = useState(displayMeta._physicalHeight || '');
  const [resolution, setResolution] = useState(displayMeta._resolution || '');
  const [resolutionPreset, setResolutionPreset] = useState(() => {
    const existing = displayMeta._resolution || '';
    const match = RESOLUTION_PRESETS.find(p => p.value === existing);
    return match ? existing : existing ? 'custom' : '';
  });
  const [customResolution, setCustomResolution] = useState(() => {
    const existing = displayMeta._resolution || '';
    const isPreset = RESOLUTION_PRESETS.some(p => p.value === existing);
    return isPreset ? '' : existing;
  });

  // Content type specific config
  const [googleSlidesUrl, setGoogleSlidesUrl] = useState('');
  const [qrSize, setQrSize] = useState<'small' | 'medium' | 'large'>('large');
  const [qrMessage, setQrMessage] = useState('Scan to RSVP!');
  const [qrShowEventInfo, setQrShowEventInfo] = useState(true);
  const [photosFilter, setPhotosFilter] = useState<'all' | 'starred'>('all');
  const [photosLayout, setPhotosLayout] = useState<'grid' | 'slideshow'>('grid');
  const [photosColumns, setPhotosColumns] = useState(3);
  const [photosAutoRefresh, setPhotosAutoRefresh] = useState(30);
  const [eventShowCountdown, setEventShowCountdown] = useState(true);
  const [eventShowGuestCount, setEventShowGuestCount] = useState(true);
  const [eventShowLocation, setEventShowLocation] = useState(true);
  const [uploadMediaUrl, setUploadMediaUrl] = useState('');
  const [uploadMediaType, setUploadMediaType] = useState<'image' | 'video'>('image');
  const [floorplanShowRentals, setFloorplanShowRentals] = useState(true);
  const [floorplanShowLabels, setFloorplanShowLabels] = useState(true);
  const [floorplanShowPrices, setFloorplanShowPrices] = useState(false);
  const [floorplanShowStatus, setFloorplanShowStatus] = useState(true);
  const [floorplanRefreshInterval, setFloorplanRefreshInterval] = useState(30);

  // Initialize from existing display config
  useEffect(() => {
    if (display?.contentConfig) {
      const config = display.contentConfig as any;
      switch (display.contentType) {
        case 'slideshow':
          setGoogleSlidesUrl(config.googleSlidesUrl || '');
          break;
        case 'qr_code':
          setQrSize(config.size || 'large');
          setQrMessage(config.message || 'Scan to RSVP!');
          setQrShowEventInfo(config.showEventInfo ?? true);
          break;
        case 'photos':
          setPhotosFilter(config.filter || 'all');
          setPhotosLayout(config.layout || 'grid');
          setPhotosColumns(config.columns || 3);
          setPhotosAutoRefresh(config.autoRefresh || 30);
          break;
        case 'event_info':
          setEventShowCountdown(config.showCountdown ?? true);
          setEventShowGuestCount(config.showGuestCount ?? true);
          setEventShowLocation(config.showLocation ?? true);
          break;
        case 'upload':
          setUploadMediaUrl(config.mediaUrl || '');
          setUploadMediaType(config.mediaType || 'image');
          break;
        case 'floorplan':
          setFloorplanShowRentals(config.showRentals ?? true);
          setFloorplanShowLabels(config.showLabels ?? true);
          setFloorplanShowPrices(config.showPrices ?? false);
          setFloorplanShowStatus(config.showStatus ?? true);
          setFloorplanRefreshInterval(config.refreshInterval || 30);
          break;
      }
    }
  }, [display]);

  // Keep resolution in sync with preset/custom
  useEffect(() => {
    if (resolutionPreset === 'custom') {
      setResolution(customResolution);
    } else {
      setResolution(resolutionPreset);
    }
  }, [resolutionPreset, customResolution]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let contentConfig: any = {};
    switch (contentType) {
      case 'slideshow':
        contentConfig = {
          googleSlidesUrl: googleSlidesUrl.trim(),
        } as SlideshowConfig;
        break;
      case 'qr_code':
        contentConfig = {
          size: qrSize,
          message: qrMessage,
          showEventInfo: qrShowEventInfo,
        } as QRCodeConfig;
        break;
      case 'photos':
        contentConfig = {
          filter: photosFilter,
          layout: photosLayout,
          columns: photosColumns,
          autoRefresh: photosAutoRefresh,
        } as PhotosConfig;
        break;
      case 'event_info':
        contentConfig = {
          showCountdown: eventShowCountdown,
          showGuestCount: eventShowGuestCount,
          showLocation: eventShowLocation,
        } as EventInfoConfig;
        break;
      case 'upload':
        contentConfig = {
          mediaUrl: uploadMediaUrl.trim(),
          mediaType: uploadMediaType,
        } as UploadConfig;
        break;
      case 'floorplan':
        contentConfig = {
          showRentals: floorplanShowRentals,
          showLabels: floorplanShowLabels,
          showPrices: floorplanShowPrices,
          showStatus: floorplanShowStatus,
          refreshInterval: floorplanRefreshInterval,
        } as FloorplanConfig;
        break;
      case 'custom':
        contentConfig = {};
        break;
    }

    // Store physical dimensions as metadata inside contentConfig
    // (prefixed with _ to distinguish from content-type-specific settings)
    if (physicalWidth) contentConfig._physicalWidth = physicalWidth;
    if (physicalHeight) contentConfig._physicalHeight = physicalHeight;
    if (resolution) contentConfig._resolution = resolution;

    onSave({
      name,
      contentType,
      contentConfig,
      rotationInterval,
      backgroundColor,
      showClock,
      showEventName,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1a2e] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#1a1a2e] border-b border-white/10 p-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {display ? 'Edit Display' : 'Create Display'}
          </h2>
          <button onClick={onClose} className="text-white/50 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Name */}
          <IconInput
            icon={Monitor}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name (e.g., Main Screen)"
            required
          />

          {/* Dimensions */}
          <div className="grid grid-cols-3 gap-2">
            <IconInput
              icon={Ruler}
              type="text"
              value={physicalWidth}
              onChange={(e) => setPhysicalWidth(e.target.value)}
              placeholder="Width (in)"
            />
            <IconInput
              icon={Ruler}
              type="text"
              value={physicalHeight}
              onChange={(e) => setPhysicalHeight(e.target.value)}
              placeholder="Height (in)"
            />
            <div>
              <select
                value={resolutionPreset}
                onChange={(e) => setResolutionPreset(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white h-[42px]"
              >
                <option value="">Resolution</option>
                {RESOLUTION_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          {resolutionPreset === 'custom' && (
            <IconInput
              icon={Monitor}
              type="text"
              value={customResolution}
              onChange={(e) => setCustomResolution(e.target.value)}
              placeholder="Custom resolution (e.g., 2560x1440)"
            />
          )}

          {/* Content Type */}
          <div>
            <p className="text-sm font-medium text-white/70 mb-2">Content Type</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {contentTypes.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setContentType(type.value)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    contentType === type.value
                      ? 'border-[#ff393a] bg-[#ff393a]/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className={`mb-1 ${contentType === type.value ? 'text-[#ff393a]' : 'text-white/50'}`}>
                    {type.icon}
                  </div>
                  <div className="text-sm font-medium text-white">{type.label}</div>
                  <div className="text-xs text-white/50">{type.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Content Type Specific Options */}
          <div className="border border-white/10 rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-white">Content Settings</h3>

            {contentType === 'slideshow' && (
              <div className="space-y-2">
                <IconInput
                  icon={ScreenShare}
                  type="url"
                  value={googleSlidesUrl}
                  onChange={(e) => setGoogleSlidesUrl(e.target.value)}
                  placeholder="Google Slides URL"
                />
                <p className="text-xs text-white/40 pl-1">Paste the share link from Google Slides</p>
              </div>
            )}

            {contentType === 'qr_code' && (
              <div className="space-y-4">
                <div>
                  <select
                    value={qrSize}
                    onChange={(e) => setQrSize(e.target.value as 'small' | 'medium' | 'large')}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>
                <IconInput
                  icon={Type}
                  type="text"
                  value={qrMessage}
                  onChange={(e) => setQrMessage(e.target.value)}
                  placeholder="Message (e.g., Scan to RSVP!)"
                />
                <Checkbox
                  checked={qrShowEventInfo}
                  onChange={() => setQrShowEventInfo(!qrShowEventInfo)}
                  label="Show event info below QR"
                />
              </div>
            )}

            {contentType === 'photos' && (
              <div className="space-y-4">
                <div>
                  <select
                    value={photosFilter}
                    onChange={(e) => setPhotosFilter(e.target.value as 'all' | 'starred')}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="all">All Photos</option>
                    <option value="starred">Starred Only</option>
                  </select>
                </div>
                <div>
                  <select
                    value={photosLayout}
                    onChange={(e) => setPhotosLayout(e.target.value as 'grid' | 'slideshow')}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="grid">Grid</option>
                    <option value="slideshow">Slideshow</option>
                  </select>
                </div>
                {photosLayout === 'grid' && (
                  <div>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={photosColumns}
                      onChange={(e) => setPhotosColumns(parseInt(e.target.value) || 3)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white"
                      placeholder="Columns (1-6)"
                    />
                  </div>
                )}
                <div>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={photosAutoRefresh}
                    onChange={(e) => setPhotosAutoRefresh(parseInt(e.target.value) || 30)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white"
                    placeholder="Auto-refresh interval (seconds)"
                  />
                </div>
              </div>
            )}

            {contentType === 'event_info' && (
              <div className="space-y-3">
                <Checkbox
                  checked={eventShowCountdown}
                  onChange={() => setEventShowCountdown(!eventShowCountdown)}
                  label="Show countdown timer"
                />
                <Checkbox
                  checked={eventShowGuestCount}
                  onChange={() => setEventShowGuestCount(!eventShowGuestCount)}
                  label="Show guest count"
                />
                <Checkbox
                  checked={eventShowLocation}
                  onChange={() => setEventShowLocation(!eventShowLocation)}
                  label="Show location"
                />
              </div>
            )}

            {contentType === 'upload' && (
              <div className="space-y-4">
                <div>
                  <select
                    value={uploadMediaType}
                    onChange={(e) => setUploadMediaType(e.target.value as 'image' | 'video')}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                  </select>
                </div>
                <IconInput
                  icon={Link}
                  type="url"
                  value={uploadMediaUrl}
                  onChange={(e) => setUploadMediaUrl(e.target.value)}
                  placeholder="Media URL (image or video link)"
                />
                <p className="text-xs text-white/40 pl-1">
                  Paste a direct link to an image or video file
                </p>
                {uploadMediaUrl && uploadMediaType === 'image' && (
                  <div className="rounded-lg overflow-hidden border border-white/10">
                    <img
                      src={uploadMediaUrl}
                      alt="Preview"
                      className="w-full max-h-48 object-contain bg-black/50"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                )}
              </div>
            )}

            {contentType === 'floorplan' && (
              <div className="space-y-4">
                <p className="text-xs text-white/40">
                  Displays the venue floorplan with rental spaces. Upload a floorplan image in the Venue tab first.
                </p>
                <div className="space-y-3">
                  <Checkbox
                    checked={floorplanShowRentals}
                    onChange={() => setFloorplanShowRentals(!floorplanShowRentals)}
                    label="Show rental shapes"
                  />
                  <Checkbox
                    checked={floorplanShowLabels}
                    onChange={() => setFloorplanShowLabels(!floorplanShowLabels)}
                    label="Show rental labels"
                  />
                  <Checkbox
                    checked={floorplanShowPrices}
                    onChange={() => setFloorplanShowPrices(!floorplanShowPrices)}
                    label="Show prices"
                  />
                  <Checkbox
                    checked={floorplanShowStatus}
                    onChange={() => setFloorplanShowStatus(!floorplanShowStatus)}
                    label="Show availability status"
                  />
                </div>
                <div>
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={floorplanRefreshInterval}
                    onChange={(e) => setFloorplanRefreshInterval(parseInt(e.target.value) || 30)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white"
                    placeholder="Refresh interval (seconds)"
                  />
                  <p className="text-xs text-white/40 pl-1 mt-1">How often to refresh rental status</p>
                </div>
              </div>
            )}
          </div>

          {/* Display Settings */}
          <div className="border border-white/10 rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-white">Display Settings</h3>

            {(contentType === 'slideshow' || contentType === 'photos') && (
              <div>
                <input
                  type="number"
                  min={3}
                  max={120}
                  value={rotationInterval}
                  onChange={(e) => setRotationInterval(parseInt(e.target.value) || 10)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white"
                  placeholder="Rotation interval (seconds)"
                />
              </div>
            )}

            <div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white font-mono"
                  placeholder="Background color"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Checkbox
                checked={showClock}
                onChange={() => setShowClock(!showClock)}
                label="Show clock overlay"
              />
              <Checkbox
                checked={showEventName}
                onChange={() => setShowEventName(!showEventName)}
                label="Show event name"
              />
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-white/10 text-white/70 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !name}
              className="flex-1 px-4 py-2 rounded-lg bg-[#ff393a] text-white font-medium hover:bg-[#ff393a]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Saving...' : display ? 'Save Changes' : 'Create Display'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
