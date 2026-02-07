import React, { useState, useEffect } from 'react';
import { X, Monitor, Image, QrCode, Info, Camera, Code, Plus, Trash2, GripVertical } from 'lucide-react';
import {
  Display,
  DisplayContentType,
  SlideshowConfig,
  QRCodeConfig,
  PhotosConfig,
  EventInfoConfig,
  SlideContent,
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
  password?: string;
}

const contentTypes: { value: DisplayContentType; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'slideshow', label: 'Slideshow', icon: <Image size={20} />, description: 'Rotating images and text' },
  { value: 'qr_code', label: 'QR Code', icon: <QrCode size={20} />, description: 'RSVP link QR code' },
  { value: 'event_info', label: 'Event Info', icon: <Info size={20} />, description: 'Event details display' },
  { value: 'photos', label: 'Photo Wall', icon: <Camera size={20} />, description: 'Live photo gallery' },
  { value: 'custom', label: 'Custom', icon: <Code size={20} />, description: 'Custom HTML content' },
];

export function DisplayForm({ display, onSave, onClose, isLoading, error }: DisplayFormProps) {
  const [name, setName] = useState(display?.name || '');
  const [contentType, setContentType] = useState<DisplayContentType>(display?.contentType || 'qr_code');
  const [rotationInterval, setRotationInterval] = useState(display?.rotationInterval || 10);
  const [backgroundColor, setBackgroundColor] = useState(display?.backgroundColor || '#000000');
  const [showClock, setShowClock] = useState(display?.showClock || false);
  const [showEventName, setShowEventName] = useState(display?.showEventName ?? true);
  const [password, setPassword] = useState('');

  // Content type specific config
  const [slideshowSlides, setSlideshowSlides] = useState<SlideContent[]>([]);
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

  // Initialize from existing display config
  useEffect(() => {
    if (display?.contentConfig) {
      const config = display.contentConfig as any;
      switch (display.contentType) {
        case 'slideshow':
          setSlideshowSlides(config.slides || []);
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
      }
    }
  }, [display]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let contentConfig: any = {};
    switch (contentType) {
      case 'slideshow':
        contentConfig = {
          slides: slideshowSlides,
          transition: 'fade',
          shuffle: false,
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
      case 'custom':
        contentConfig = {};
        break;
    }

    onSave({
      name,
      contentType,
      contentConfig,
      rotationInterval,
      backgroundColor,
      showClock,
      showEventName,
      password: password || undefined,
    });
  };

  const addSlide = () => {
    setSlideshowSlides([...slideshowSlides, { type: 'text', content: '' }]);
  };

  const removeSlide = (index: number) => {
    setSlideshowSlides(slideshowSlides.filter((_, i) => i !== index));
  };

  const updateSlide = (index: number, updates: Partial<SlideContent>) => {
    setSlideshowSlides(slides =>
      slides.map((slide, i) => (i === index ? { ...slide, ...updates } : slide))
    );
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
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
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Main Screen, Photo Wall, etc."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
              required
            />
          </div>

          {/* Content Type */}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Content Type</label>
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
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/70">Slides</span>
                  <button
                    type="button"
                    onClick={addSlide}
                    className="flex items-center gap-1 text-sm text-[#ff393a] hover:text-[#ff393a]/80"
                  >
                    <Plus size={14} />
                    Add Slide
                  </button>
                </div>
                {slideshowSlides.length === 0 ? (
                  <p className="text-sm text-white/40 text-center py-4">
                    No slides yet. Add slides to create your slideshow.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {slideshowSlides.map((slide, index) => (
                      <div key={index} className="flex items-start gap-2 bg-white/5 rounded-lg p-3">
                        <GripVertical size={16} className="text-white/30 mt-2 cursor-move" />
                        <div className="flex-1 space-y-2">
                          <select
                            value={slide.type}
                            onChange={(e) => updateSlide(index, { type: e.target.value as SlideContent['type'] })}
                            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white"
                          >
                            <option value="text">Text</option>
                            <option value="image">Image URL</option>
                            <option value="qr">QR Code</option>
                          </select>
                          {slide.type === 'text' && (
                            <input
                              type="text"
                              value={slide.content || ''}
                              onChange={(e) => updateSlide(index, { content: e.target.value })}
                              placeholder="Enter text..."
                              className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white"
                            />
                          )}
                          {slide.type === 'image' && (
                            <input
                              type="url"
                              value={slide.url || ''}
                              onChange={(e) => updateSlide(index, { url: e.target.value })}
                              placeholder="Image URL..."
                              className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white"
                            />
                          )}
                          {slide.type === 'qr' && (
                            <input
                              type="url"
                              value={slide.url || ''}
                              onChange={(e) => updateSlide(index, { url: e.target.value })}
                              placeholder="URL to encode..."
                              className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white"
                            />
                          )}
                          <input
                            type="text"
                            value={slide.caption || ''}
                            onChange={(e) => updateSlide(index, { caption: e.target.value })}
                            placeholder="Caption (optional)"
                            className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSlide(index)}
                          className="text-red-400 hover:text-red-300 mt-2"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {contentType === 'qr_code' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-white/70 mb-1">QR Size</label>
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
                <div>
                  <label className="block text-sm text-white/70 mb-1">Message</label>
                  <input
                    type="text"
                    value={qrMessage}
                    onChange={(e) => setQrMessage(e.target.value)}
                    placeholder="Scan to RSVP!"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={qrShowEventInfo}
                    onChange={(e) => setQrShowEventInfo(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-white/70">Show event info below QR</span>
                </label>
              </div>
            )}

            {contentType === 'photos' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-white/70 mb-1">Filter</label>
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
                  <label className="block text-sm text-white/70 mb-1">Layout</label>
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
                    <label className="block text-sm text-white/70 mb-1">Columns</label>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={photosColumns}
                      onChange={(e) => setPhotosColumns(parseInt(e.target.value) || 3)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm text-white/70 mb-1">Auto-refresh (seconds)</label>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={photosAutoRefresh}
                    onChange={(e) => setPhotosAutoRefresh(parseInt(e.target.value) || 30)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white"
                  />
                </div>
              </div>
            )}

            {contentType === 'event_info' && (
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={eventShowCountdown}
                    onChange={(e) => setEventShowCountdown(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-white/70">Show countdown timer</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={eventShowGuestCount}
                    onChange={(e) => setEventShowGuestCount(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-white/70">Show guest count</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={eventShowLocation}
                    onChange={(e) => setEventShowLocation(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-white/70">Show location</span>
                </label>
              </div>
            )}

            {contentType === 'custom' && (
              <p className="text-sm text-white/50">
                Custom content configuration coming soon. For now, create a slideshow with your content.
              </p>
            )}
          </div>

          {/* Display Settings */}
          <div className="border border-white/10 rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-white">Display Settings</h3>

            {(contentType === 'slideshow' || contentType === 'photos') && (
              <div>
                <label className="block text-sm text-white/70 mb-1">
                  Rotation Interval (seconds)
                </label>
                <input
                  type="number"
                  min={3}
                  max={120}
                  value={rotationInterval}
                  onChange={(e) => setRotationInterval(parseInt(e.target.value) || 10)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white"
                />
              </div>
            )}

            <div>
              <label className="block text-sm text-white/70 mb-1">Background Color</label>
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
                />
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showClock}
                  onChange={(e) => setShowClock(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-white/70">Show clock overlay</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showEventName}
                  onChange={(e) => setShowEventName(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-white/70">Show event name</span>
              </label>
            </div>
          </div>

          {/* Password Protection */}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">
              Password Protection (optional)
            </label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave empty for no password"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
            />
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
