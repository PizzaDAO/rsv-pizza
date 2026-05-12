import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Monitor, Image, QrCode, Info, Camera, Upload, Ruler, ScreenShare, Type, Link, Grid3X3, RefreshCw, Timer, Palette } from 'lucide-react';
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

const contentTypes: { value: DisplayContentType; labelKey: string; icon: React.ReactNode; descriptionKey: string }[] = [
  { value: 'slideshow', labelKey: 'displays.slideshow', icon: <Image size={20} />, descriptionKey: 'displays.slideshowDesc' },
  { value: 'qr_code', labelKey: 'displays.qrCode', icon: <QrCode size={20} />, descriptionKey: 'displays.qrCodeDesc' },
  { value: 'event_info', labelKey: 'displays.eventInfo', icon: <Info size={20} />, descriptionKey: 'displays.eventInfoDesc' },
  { value: 'photos', labelKey: 'displays.photoWall', icon: <Camera size={20} />, descriptionKey: 'displays.photoWallDesc' },
  { value: 'upload', labelKey: 'displays.upload', icon: <Upload size={20} />, descriptionKey: 'displays.uploadDesc' },
];

const RESOLUTION_PRESETS = [
  { value: '1920x1080', label: '1920x1080 (Full HD)' },
  { value: '3840x2160', label: '3840x2160 (4K)' },
  { value: '1280x720', label: '1280x720 (HD)' },
  { value: '1024x768', label: '1024x768 (XGA)' },
  { value: 'custom', label: 'Custom' },
];

export function DisplayForm({ display, onSave, onClose, isLoading, error }: DisplayFormProps) {
  const { t } = useTranslation('host');
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
      <div className="bg-theme-header rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-theme-header border-b border-theme-stroke p-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-theme-text">
            {display ? t('displays.editDisplay') : t('displays.createDisplay')}
          </h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text">
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
            placeholder={t('displays.displayName')}
            required
          />

          {/* Dimensions */}
          <div className="grid grid-cols-3 gap-2">
            <IconInput
              icon={Ruler}
              type="text"
              value={physicalWidth}
              onChange={(e) => setPhysicalWidth(e.target.value)}
              placeholder={t('displays.widthIn')}
            />
            <IconInput
              icon={Ruler}
              type="text"
              value={physicalHeight}
              onChange={(e) => setPhysicalHeight(e.target.value)}
              placeholder={t('displays.heightIn')}
            />
            <div>
              <select
                value={resolutionPreset}
                onChange={(e) => setResolutionPreset(e.target.value)}
                className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text h-[42px]"
              >
                <option value="">{t('displays.resolution')}</option>
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
              placeholder={t('displays.customResolution')}
            />
          )}

          {/* Content Type */}
          <div>
            <p className="text-sm font-medium text-theme-text-secondary mb-2">{t('displays.contentType')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {contentTypes.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setContentType(type.value)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    contentType === type.value
                      ? 'border-[#ff393a] bg-[#ff393a]/10'
                      : 'border-theme-stroke bg-theme-surface hover:bg-theme-surface-hover'
                  }`}
                >
                  <div className={`mb-1 ${contentType === type.value ? 'text-[#ff393a]' : 'text-theme-text-muted'}`}>
                    {type.icon}
                  </div>
                  <div className="text-sm font-medium text-theme-text">{t(type.labelKey)}</div>
                  <div className="text-xs text-theme-text-muted">{t(type.descriptionKey)}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Content Type Specific Options */}
          <div className="border border-theme-stroke rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-theme-text">{t('displays.contentSettings')}</h3>

            {contentType === 'slideshow' && (
              <div className="space-y-2">
                <IconInput
                  icon={ScreenShare}
                  type="url"
                  value={googleSlidesUrl}
                  onChange={(e) => setGoogleSlidesUrl(e.target.value)}
                  placeholder={t('displays.googleSlidesUrl')}
                />
                <p className="text-xs text-theme-text-muted pl-1">{t('displays.googleSlidesHint')}</p>
              </div>
            )}

            {contentType === 'qr_code' && (
              <div className="space-y-4">
                <div>
                  <select
                    value={qrSize}
                    onChange={(e) => setQrSize(e.target.value as 'small' | 'medium' | 'large')}
                    className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text"
                  >
                    <option value="small">{t('displays.small')}</option>
                    <option value="medium">{t('displays.medium')}</option>
                    <option value="large">{t('displays.large')}</option>
                  </select>
                </div>
                <IconInput
                  icon={Type}
                  type="text"
                  value={qrMessage}
                  onChange={(e) => setQrMessage(e.target.value)}
                  placeholder={t('displays.messagePlaceholder')}
                />
                <Checkbox
                  checked={qrShowEventInfo}
                  onChange={() => setQrShowEventInfo(!qrShowEventInfo)}
                  label={t('displays.showEventInfoBelow')}
                />
              </div>
            )}

            {contentType === 'photos' && (
              <div className="space-y-4">
                <div>
                  <select
                    value={photosFilter}
                    onChange={(e) => setPhotosFilter(e.target.value as 'all' | 'starred')}
                    className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text"
                  >
                    <option value="all">{t('displays.allPhotos')}</option>
                    <option value="starred">{t('displays.starredOnly')}</option>
                  </select>
                </div>
                <div>
                  <select
                    value={photosLayout}
                    onChange={(e) => setPhotosLayout(e.target.value as 'grid' | 'slideshow')}
                    className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text"
                  >
                    <option value="grid">{t('displays.grid')}</option>
                    <option value="slideshow">{t('displays.slideshowLayout')}</option>
                  </select>
                </div>
                {photosLayout === 'grid' && (
                  <IconInput
                    icon={Grid3X3}
                    type="number"
                    min={1}
                    max={6}
                    value={photosColumns}
                    onChange={(e) => setPhotosColumns(parseInt(e.target.value) || 3)}
                    placeholder={t('displays.columnsPlaceholder')}
                  />
                )}
                <IconInput
                  icon={RefreshCw}
                  type="number"
                  min={5}
                  max={300}
                  value={photosAutoRefresh}
                  onChange={(e) => setPhotosAutoRefresh(parseInt(e.target.value) || 30)}
                  placeholder={t('displays.autoRefreshInterval')}
                />
              </div>
            )}

            {contentType === 'event_info' && (
              <div className="space-y-3">
                <Checkbox
                  checked={eventShowCountdown}
                  onChange={() => setEventShowCountdown(!eventShowCountdown)}
                  label={t('displays.showCountdownTimer')}
                />
                <Checkbox
                  checked={eventShowGuestCount}
                  onChange={() => setEventShowGuestCount(!eventShowGuestCount)}
                  label={t('displays.showGuestCount')}
                />
                <Checkbox
                  checked={eventShowLocation}
                  onChange={() => setEventShowLocation(!eventShowLocation)}
                  label={t('displays.showLocation')}
                />
              </div>
            )}

            {contentType === 'upload' && (
              <div className="space-y-4">
                <div>
                  <select
                    value={uploadMediaType}
                    onChange={(e) => setUploadMediaType(e.target.value as 'image' | 'video')}
                    className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text"
                  >
                    <option value="image">{t('displays.image')}</option>
                    <option value="video">{t('displays.video')}</option>
                  </select>
                </div>
                <IconInput
                  icon={Link}
                  type="url"
                  value={uploadMediaUrl}
                  onChange={(e) => setUploadMediaUrl(e.target.value)}
                  placeholder={t('displays.mediaUrl')}
                />
                <p className="text-xs text-theme-text-muted pl-1">
                  {t('displays.mediaUrlHint')}
                </p>
                {uploadMediaUrl && uploadMediaType === 'image' && (
                  <div className="rounded-lg overflow-hidden border border-theme-stroke">
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
          </div>

          {/* Display Settings */}
          <div className="border border-theme-stroke rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-theme-text">{t('displays.displaySettings')}</h3>

            {(contentType === 'slideshow' || contentType === 'photos') && (
              <IconInput
                icon={Timer}
                type="number"
                min={3}
                max={120}
                value={rotationInterval}
                onChange={(e) => setRotationInterval(parseInt(e.target.value) || 10)}
                placeholder={t('displays.rotationInterval')}
              />
            )}

            <div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer"
                />
                <IconInput
                  icon={Palette}
                  type="text"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  placeholder={t('displays.backgroundColor')}
                  className="font-mono"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Checkbox
                checked={showClock}
                onChange={() => setShowClock(!showClock)}
                label={t('displays.showClockOverlay')}
              />
              <Checkbox
                checked={showEventName}
                onChange={() => setShowEventName(!showEventName)}
                label={t('displays.showEventName')}
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
          <div className="flex items-center gap-3 pt-4 border-t border-theme-stroke">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-theme-stroke text-theme-text-secondary hover:bg-theme-surface transition-colors"
            >
              {t('displays.cancel')}
            </button>
            <button
              type="submit"
              disabled={isLoading || !name}
              className="flex-1 px-4 py-2 rounded-lg bg-[#ff393a] text-white font-medium hover:bg-[#ff393a]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? t('displays.saving') : display ? t('displays.saveChanges') : t('displays.createDisplay')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
