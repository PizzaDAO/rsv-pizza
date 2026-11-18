import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { TimePickerInput } from './TimePickerInput';
import { TimezonePickerInput } from './TimezonePickerInput';
import { LocationAutocomplete } from './LocationAutocomplete';
import { LoginModal } from './LoginModal';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, Users, Lock, Image, FileText, Upload, Trash2, ChevronDown, ChevronUp, Square as SquareIcon, CheckSquare2, Calendar, PartyPopper } from 'lucide-react';
import { createParty as createPartyAPI, uploadEventImage } from '../lib/supabase';
import { CustomUrlInput } from './CustomUrlInput';
import { resolveSchedule, type ScheduleError, nextEndDate, DEFAULT_START_TIME, DEFAULT_END_TIME } from '../utils/eventSchedule';
import { formatDateDisplay, formatTimeDisplay, formatTimezoneDisplay } from '../utils/dateUtils';
import { useTranslation } from 'react-i18next';
import { BRAND } from '../config/brand';
import { IS_SERIES_SCOPED } from '../config/brandScope';
import { fetchPublicSeries } from '../lib/api';
import { IconInput } from './IconInput';
import { saveEventDraft, loadEventDraftFor, clearEventDraft } from '../lib/eventDraft';
import { prepareSquareImage, SquareImageError } from '../lib/squareImage';

export function EventForm() {
  const { t } = useTranslation('account');
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const startDateInputRef = useRef<HTMLInputElement>(null);
  const endDateInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [partyName, setPartyName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timezone, setTimezone] = useState('');
  const [expectedGuests, setExpectedGuests] = useState('');
  const [partyAddress, setPartyAddress] = useState('');
  const [partyPlaceId, setPartyPlaceId] = useState<string | null>(null);
  const [partyVenueName, setPartyVenueName] = useState<string | null>(null);
  const [partyCity, setPartyCity] = useState<string | null>(null);
  // calzone-71208: country + lat/lng were silently dropped on create — 61 of 982
  // prod events shipped with country IS NULL. Capture them from autocomplete now.
  const [partyCountry, setPartyCountry] = useState<string | null>(null);
  const [partyLat, setPartyLat] = useState<number | null>(null);
  const [partyLng, setPartyLng] = useState<number | null>(null);
  const [partyPassword, setPartyPassword] = useState('');
  const [eventImageUrl, setEventImageUrl] = useState('');
  const [eventImageFile, setEventImageFile] = useState<File | null>(null);
  const [processingImage, setProcessingImage] = useState(false);
  const imageRequestRef = useRef(0);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  // One top-level form error; `field` says which control to focus so the host can fix it.
  const [formError, setFormErrorState] = useState<{ message: string; field?: 'name' | 'date' | 'url' | 'image' } | null>(null);
  const setFormError = (message: string | null, field?: 'name' | 'date' | 'url' | 'image') =>
    setFormErrorState(message ? { message, field } : null);
  const [draftRestored, setDraftRestored] = useState(false);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const customUrlWrapRef = useRef<HTMLDivElement>(null);
  const imageSectionRef = useRef<HTMLDivElement>(null);
  const [eventDescription, setEventDescription] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customUrlValid, setCustomUrlValid] = useState(true);
  const [customUrlError, setCustomUrlError] = useState<string | undefined>();
  const [requireApproval, setRequireApproval] = useState(false);
  const [limitGuests, setLimitGuests] = useState(false);
  const [hideGuests, setHideGuests] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showDateTimeModal, setShowDateTimeModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Get user's timezone on mount
  useEffect(() => {
    try {
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setTimezone(userTimezone);
    } catch (error) {
      console.warn('Timezone detection failed, using UTC', error);
      setTimezone('UTC');
    }
  }, []);

  // Series-scoped builds (e.g. Doge Day): pre-fill the date with the series' event date.
  // Inert on the default build and on series without an event date. Only fills empty fields, so
  // anything the host already typed (or changes afterwards) wins.
  useEffect(() => {
    if (!IS_SERIES_SCOPED) return;
    let cancelled = false;
    fetchPublicSeries(BRAND.seriesSlug)
      .then(({ series }) => {
        if (cancelled || !series.eventDate) return;
        const d = series.eventDate.slice(0, 10);
        setStartDate((prev) => prev || d);
        setEndDate((prev) => prev || d);
        if (series.eventStartTime) setStartTime((prev) => prev || series.eventStartTime!);
        if (series.eventEndTime) setEndTime((prev) => prev || series.eventEndTime!);
      })
      .catch(() => { /* no prefill if the series can't be loaded */ });
    return () => { cancelled = true; };
  }, []);

  // Restore a draft saved before the email-code login (persisted in localStorage so it survives
  // the code / magic link opening in another tab). Never auto-submits: the host reviews first.
  const draftChecked = useRef(false);
  useEffect(() => {
    if (draftChecked.current || authLoading) return;
    draftChecked.current = true;
    const d = loadEventDraftFor(user?.email) as Record<string, any> | null;
    if (!d) return;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    setPartyName(str(d.partyName));
    setStartDate(str(d.startDate));
    setStartTime(str(d.startTime));
    setEndDate(str(d.endDate));
    setEndTime(str(d.endTime));
    if (str(d.timezone)) setTimezone(str(d.timezone));
    setExpectedGuests(str(d.expectedGuests));
    setPartyAddress(str(d.partyAddress));
    setPartyPlaceId((d.partyPlaceId as string) || null);
    setPartyVenueName((d.partyVenueName as string) || null);
    setPartyCity((d.partyCity as string) || null);
    setPartyCountry((d.partyCountry as string) ?? null);
    setPartyLat(typeof d.partyLat === 'number' ? d.partyLat : null);
    setPartyLng(typeof d.partyLng === 'number' ? d.partyLng : null);
    setPartyPassword(str(d.partyPassword));
    setEventImageUrl(str(d.eventImageUrl));
    setEventDescription(str(d.eventDescription));
    setCustomUrl(str(d.customUrl));
    setRequireApproval(!!d.requireApproval);
    setLimitGuests(!!d.limitGuests);
    setHideGuests(!!d.hideGuests);
    if (d.partyPassword || d.limitGuests || d.requireApproval || d.hideGuests) setShowOptionalFields(true);
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // Surface errors: scroll the banner into view and focus the offending field.
  useEffect(() => {
    if (!formError) return;
    formErrorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    const target =
      formError.field === 'name' ? nameInputRef.current
      : formError.field === 'date' ? (startDateInputRef.current && startDateInputRef.current.offsetParent ? startDateInputRef.current : null)
      : formError.field === 'url' ? customUrlWrapRef.current?.querySelector('input') ?? null
      : null;
    (target as HTMLElement | null)?.focus?.({ preventScroll: true });
  }, [formError]);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;

    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview);
    }

    setFormErrorState((cur) => (cur?.field === 'image' ? null : cur));
    const token = ++imageRequestRef.current;
    setProcessingImage(true);

    try {
      const squareFile = await prepareSquareImage(file);
      if (token !== imageRequestRef.current) return; // a newer pick or a removal superseded this one
      setEventImageFile(squareFile);
      setImagePreview(URL.createObjectURL(squareFile));
    } catch (err) {
      if (token !== imageRequestRef.current) return;
      setEventImageFile(null);
      setImagePreview(null);
      const codeKey: Record<string, string> = {
        NOT_IMAGE: 'eventForm.imageSelectError',
        TOO_LARGE: 'eventForm.imageSizeError',
        HEIC_FAILED: 'eventForm.imageHeicError',
        LOAD_FAILED: 'eventForm.imageLoadError',
      };
      const key = err instanceof SquareImageError ? codeKey[err.code] : undefined;
      setFormError(t(key ?? 'eventForm.imageLoadError'), 'image');
    } finally {
      if (token === imageRequestRef.current) setProcessingImage(false);
      // allow re-picking the same file
      input.value = '';
    }
  };

  const removeImage = () => {
    imageRequestRef.current++;
    setProcessingImage(false);
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview);
    }
    setEventImageFile(null);
    setImagePreview(null);
    setFormErrorState((cur) => (cur?.field === 'image' ? null : cur));
    setEventImageUrl('');
  };

  const scheduleErrorMessage = (code: ScheduleError): string => {
    switch (code) {
      case 'needsStartDate': return t('eventForm.scheduleNeedsStartDate');
      case 'invalid': return t('eventForm.scheduleInvalid');
      case 'endBeforeStart': return t('eventForm.scheduleEndBeforeStart');
    }
  };

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!user) {
      const formData = {
        partyName, startDate, startTime, endDate, endTime, timezone,
        expectedGuests, partyAddress, partyPlaceId, partyVenueName, partyCity,
        // calzone-71208: persist country + lat/lng across the auth roundtrip
        // so we don't lose them when the form is restored post-login.
        partyCountry, partyLat, partyLng,
        partyPassword, eventImageUrl, eventDescription,
        customUrl, requireApproval, limitGuests, hideGuests
      };
      saveEventDraft(formData);
      try { sessionStorage.setItem('authReturnUrl', '/new'); } catch { /* ignore */ }
      setShowLoginModal(true);
      return;
    }

    setFormError(null);
    setCreating(true);

    try {
      const guestCount = expectedGuests ? parseInt(expectedGuests, 10) : undefined;
      const password = partyPassword.trim() || undefined;
      const description = eventDescription.trim() || undefined;
      const urlSlug = customUrl.trim() || undefined;

      // Check if custom URL is valid (already validated by CustomUrlInput)
      if (urlSlug && !customUrlValid) {
        setFormError(customUrlError || t('eventForm.invalidCustomUrl'), 'url');
        setCreating(false);
        return;
      }

      // Use the event's timezone when parsing the entered date/time
      const tz = timezone || 'UTC';
      const schedule = resolveSchedule({ startDate, startTime, endDate, endTime, timezone: tz });
      if (schedule.error) {
        setFormError(scheduleErrorMessage(schedule.error), 'date');
        setCreating(false);
        return;
      }
      const { startDateTime, duration } = schedule;

      let imageUrl = eventImageUrl.trim() || undefined;
      if (eventImageFile) {
        try {
          imageUrl = await uploadEventImage(eventImageFile);
        } catch (err) {
          setFormError(err instanceof Error ? err.message : t('eventForm.imageUploadFailed'), 'image');
          setCreating(false);
          return;
        }
      }

      const party = await createPartyAPI({
        name: partyName.trim() || undefined,
        hostName: user?.name || undefined,
        date: startDateTime,
        pizzaStyle: 'new-york',
        expectedGuests: guestCount,
        address: partyAddress.trim() || undefined,
        availableBeverages: [],
        duration,
        password,
        eventImageUrl: imageUrl,
        description,
        customUrl: urlSlug,
        timezone: timezone || undefined,
        hideGuests,
        placeId: partyPlaceId || undefined,
        venueName: partyVenueName || undefined,
        city: partyCity || undefined,
        country: partyCountry,
        latitude: partyLat,
        longitude: partyLng,
      });

      setCreating(false);

      if (party?.invite_code) {
        clearEventDraft();
        navigate(`/host/${party.invite_code}`);
      } else {
        setFormError(t('eventForm.createFailed'));
      }
    } catch (error) {
      console.error('Error creating party:', error);
      setFormError(t('eventForm.createFailed'));
      setCreating(false);
    }
  };

  return (
    <>
      <form onSubmit={handleCreate} className="space-y-3" noValidate>
        {draftRestored && (
          <div className="rounded-xl border border-[#39d98a]/30 bg-[#39d98a]/10 px-4 py-3 text-sm text-theme-text" role="status" data-testid="event-form-draft-restored">
            {t('eventForm.draftRestored')}
          </div>
        )}
        {formError && (
          <div
            ref={formErrorRef}
            role="alert"
            tabIndex={-1}
            className="rounded-xl border border-[#ff393a]/40 bg-[#ff393a]/10 px-4 py-3 text-sm text-[#ff393a]"
            data-testid="event-form-error"
          >
            {formError.message}
          </div>
        )}
        <IconInput
          ref={nameInputRef}
          icon={PartyPopper}
          type="text"
          value={partyName}
          onChange={(e) => setPartyName(e.target.value)}
          placeholder={t('eventForm.partyName')}
          aria-label={t('eventForm.partyName')}
          aria-invalid={formError?.field === 'name' || undefined}
          autoFocus
          data-testid="event-form-name"
        />

        <LocationAutocomplete
          value={partyAddress}
          onChange={(newAddress) => {
            setPartyAddress(newAddress);
            // Manual edits without picking from dropdown invalidate captured place_id + venue_name
            setPartyPlaceId(null);
            setPartyVenueName(null);
            // calzone-71208: also invalidate country/lat/lng so we don't ship
            // a stale Google answer attached to a hand-typed address.
            setPartyCountry(null);
            setPartyLat(null);
            setPartyLng(null);
          }}
          onTimezoneChange={setTimezone}
          onLocationSelected={(loc) => {
            setPartyLat(loc?.lat ?? null);
            setPartyLng(loc?.lng ?? null);
          }}
          onCitySelected={(cityData) => {
            setPartyCity(cityData.cityName || null);
            setPartyCountry(cityData.country || null);
          }}
          onPlaceSelected={(address, venueName, placeId) => {
            setPartyAddress(address);
            setPartyPlaceId(placeId);
            setPartyVenueName(venueName);
          }}
          placeholder={t('eventForm.eventLocation')}
        />

        {/* Mobile: Date/Time Button */}
        <button
          type="button"
          onClick={() => setShowDateTimeModal(true)}
          className="md:hidden w-full bg-theme-surface border border-theme-stroke rounded-xl p-4 text-left hover:bg-theme-surface-hover transition-colors"
        >
          <div className="flex items-center gap-3">
            <Calendar size={18} className="text-theme-text-muted flex-shrink-0" aria-hidden="true" />
            {startDate && startTime && endDate && endTime ? (
              <div>
                <div className="text-theme-text font-medium">
                  {formatDateDisplay(startDate, timezone)}
                </div>
                <div className="text-theme-text-secondary text-sm mt-1">
                  {formatTimeDisplay(startTime)} — {formatTimeDisplay(endTime)} {formatTimezoneDisplay(timezone)}
                </div>
              </div>
            ) : (
              <div>
                <span className="text-theme-text-secondary">{t('eventForm.datePlaceholder')}</span>
                <div className="text-theme-text-muted text-sm mt-1">{t('eventForm.timePlaceholder')}</div>
              </div>
            )}
          </div>
        </button>

        {/* Desktop: Inline Date/Time Picker */}
        <div className="hidden md:block bg-theme-surface border border-theme-stroke rounded-xl p-4">
          <div className="flex items-start gap-4">
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-3">
                <div
                  className="relative flex-1 cursor-pointer"
                  onClick={() => startDateInputRef.current?.showPicker?.()}
                >
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-2 text-theme-text-muted">
                    <Calendar size={18} aria-hidden="true" />
                    <span className="text-xs w-12">{t('eventForm.starts')}</span>
                  </div>
                  <input
                    ref={startDateInputRef}
                    type="date"
                    aria-label={t('eventForm.startDate')}
                    value={startDate}
                    onChange={(e) => {
                      setEndDate(nextEndDate(startDate, e.target.value, endDate));
                      setStartDate(e.target.value);
                      setFormErrorState((cur) => (cur?.field === 'date' ? null : cur));
                    }}
                    className="w-full bg-transparent border-none text-theme-text text-sm text-left focus:outline-none focus:ring-0 p-0 pl-24 pr-2 cursor-pointer [&::-webkit-calendar-picker-indicator]:hidden"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>
                <TimePickerInput
                  value={startTime}
                  onChange={setStartTime}
                  placeholder={formatTimeDisplay(DEFAULT_START_TIME)}
                />
              </div>

              <div className="flex items-center gap-3">
                <div
                  className="relative flex-1 cursor-pointer"
                  onClick={() => endDateInputRef.current?.showPicker?.()}
                >
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-2 text-theme-text-muted">
                    <Calendar size={18} aria-hidden="true" />
                    <span className="text-xs w-12">{t('eventForm.ends')}</span>
                  </div>
                  <input
                    ref={endDateInputRef}
                    type="date"
                    aria-label={t('eventForm.endDate')}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-transparent border-none text-theme-text text-sm text-left focus:outline-none focus:ring-0 p-0 pl-24 pr-2 cursor-pointer [&::-webkit-calendar-picker-indicator]:hidden"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>
                <TimePickerInput
                  value={endTime}
                  onChange={setEndTime}
                  placeholder={formatTimeDisplay(DEFAULT_END_TIME)}
                />
              </div>
            </div>

            <TimezonePickerInput
              value={timezone}
              onChange={setTimezone}
            />
          </div>
        </div>

        <IconInput
          multiline
          icon={FileText}
          iconSize={18}
          value={eventDescription}
          onChange={(e) => setEventDescription(e.target.value)}
          placeholder={t('eventForm.description')}
          className="text-left"
          rows={3}
        />


        <div ref={imageSectionRef}>
          {imagePreview ? (
            <div className="space-y-3 mb-3">
              <div className="relative w-full max-w-xs mx-auto">
                <img
                  src={imagePreview}
                  alt="Event flyer preview"
                  className="w-full h-auto rounded-xl border-2 border-theme-stroke-hover"
                />
                <button
                  type="button"
                  onClick={removeImage}
                  className="absolute top-2 right-2 p-2 bg-red-500/90 hover:bg-red-600 rounded-full text-white transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ) : (
            <div className="relative mb-3">
              <input
                type="file"
                id="eventImage"
                accept="image/*,.heic,.heif"
                onChange={handleImageChange}
                className="hidden"
                disabled={!!eventImageUrl.trim() || processingImage}
              />
              <label
                htmlFor="eventImage"
                className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-theme-stroke-hover rounded-xl cursor-pointer hover:border-[#ff393a]/50 transition-colors bg-theme-surface hover:bg-theme-surface-hover ${
                  eventImageUrl.trim() ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <Upload className="w-8 h-8 text-theme-text-muted mb-2" />
                <span className="text-sm text-theme-text-secondary">{t('eventForm.uploadImage')}</span>
                <span className="text-xs text-theme-text-muted mt-1">{t('eventForm.uploadImageHint')}</span>
              </label>
            </div>
          )}

          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-px bg-theme-surface-hover"></div>
            <span className="text-xs text-theme-text-muted">{t('eventForm.or')}</span>
            <div className="flex-1 h-px bg-theme-surface-hover"></div>
          </div>

          <div className="relative">
            <Image size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
            <input
              type="url"
              value={eventImageUrl}
              onChange={(e) => {
                setEventImageUrl(e.target.value);
                if (e.target.value.trim()) {
                  setEventImageFile(null);
                  setImagePreview(null);
                  setFormErrorState((cur) => (cur?.field === 'image' ? null : cur));
                }
              }}
              placeholder={t('eventForm.imageUrl')}
              className="w-full !pl-11"
            />
          </div>

          {processingImage && (
            <p className="text-xs text-theme-text-muted mt-2 flex items-center gap-1.5" role="status">
              <Loader2 size={12} className="animate-spin" />
              {t('eventForm.processingImage')}
            </p>
          )}

        </div>

        {/* Custom URL: a primary field, not buried in Options */}
        <div ref={customUrlWrapRef}>
          <CustomUrlInput
            value={customUrl}
            onChange={setCustomUrl}
            onValidationChange={(isValid, error) => {
              setCustomUrlValid(isValid);
              setCustomUrlError(error);
            }}
          />
        </div>

        {/* Options Toggle */}
        <button
          type="button"
          onClick={() => setShowOptionalFields(!showOptionalFields)}
          className="w-full flex items-center justify-between p-4 bg-theme-surface hover:bg-theme-surface-hover border border-theme-stroke rounded-xl transition-colors"
        >
          <span className="text-sm font-medium text-theme-text">
            {t('eventForm.options')}
          </span>
          {showOptionalFields ? (
            <ChevronUp size={18} className="text-theme-text-secondary" />
          ) : (
            <ChevronDown size={18} className="text-theme-text-secondary" />
          )}
        </button>

        {/* Collapsible Options */}
        {showOptionalFields && (
          <div className="space-y-3 border-l-2 border-theme-stroke pl-4">
            <div>
              <button
                type="button"
                onClick={() => setRequireApproval(!requireApproval)}
                className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
              >
                {requireApproval ? (
                  <CheckSquare2 size={18} className="text-[#ff393a] flex-shrink-0" />
                ) : (
                  <SquareIcon size={18} className="text-theme-text-muted flex-shrink-0" />
                )}
                <span className="text-sm font-medium text-theme-text">{t('eventForm.requireApproval')}</span>
              </button>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setLimitGuests(!limitGuests)}
                className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
              >
                {limitGuests ? (
                  <CheckSquare2 size={18} className="text-[#ff393a] flex-shrink-0" />
                ) : (
                  <SquareIcon size={18} className="text-theme-text-muted flex-shrink-0" />
                )}
                <span className="text-sm font-medium text-theme-text">{t('eventForm.limitGuests')}</span>
              </button>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setHideGuests(!hideGuests)}
                className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
              >
                {hideGuests ? (
                  <CheckSquare2 size={18} className="text-[#ff393a] flex-shrink-0" />
                ) : (
                  <SquareIcon size={18} className="text-theme-text-muted flex-shrink-0" />
                )}
                <span className="text-sm font-medium text-theme-text">{t('eventForm.hideGuests')}</span>
              </button>
            </div>

            {limitGuests && (
              <div className="relative">
                <Users size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
                <input
                  type="number"
                  min="1"
                  value={expectedGuests}
                  onChange={(e) => setExpectedGuests(e.target.value)}
                  placeholder={t('eventForm.capacity')}
                  className="w-full !pl-14"
                />
              </div>
            )}

            <div className="relative">
              <Lock size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
              <input
                type="password"
                value={partyPassword}
                onChange={(e) => setPartyPassword(e.target.value)}
                placeholder={t('eventForm.eventPassword')}
                className="w-full !pl-14"
              />
            </div>
          </div>
        )}

        {!user && (
          <p className="text-xs text-theme-text-muted text-center" data-testid="event-form-confirm-email-note">
            {t('eventForm.confirmEmailNote')}
          </p>
        )}
        <button
          type="submit"
          className="btn-primary w-full flex items-center justify-center gap-2 text-lg py-4"
          disabled={creating || processingImage}
          data-testid="event-form-submit"
        >
          {creating ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              {t('eventForm.creating')}
            </>
          ) : (
            t('eventForm.createParty')
          )}
        </button>
      </form>

      {/* Mobile Date/Time Modal */}
      {showDateTimeModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70" onClick={() => setShowDateTimeModal(false)}>
          <div className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-theme-text mb-4">{t('eventForm.eventTime')}</h2>

            <div className="space-y-3">
              {/* Start Date */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Calendar size={14} className="text-theme-text-muted" aria-hidden="true" />
                  <span className="text-xs text-theme-text-muted">{t('eventForm.startDate')}</span>
                </div>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setEndDate(nextEndDate(startDate, e.target.value, endDate));
                    setStartDate(e.target.value);
                  }}
                  onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] cursor-pointer"
                  style={{ colorScheme: 'dark' }}
                />
              </div>

              {/* Start Time */}
              <div>
                <span className="text-xs text-theme-text-muted mb-1 block ml-0.5">{t('eventForm.startTime')}</span>
                <TimePickerInput
                  value={startTime}
                  onChange={setStartTime}
                  placeholder={formatTimeDisplay(DEFAULT_START_TIME)}
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
              </div>

              {/* End Date */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Calendar size={14} className="text-theme-text-muted" aria-hidden="true" />
                  <span className="text-xs text-theme-text-muted">{t('eventForm.endDate')}</span>
                </div>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] cursor-pointer"
                  style={{ colorScheme: 'dark' }}
                />
              </div>

              {/* End Time */}
              <div>
                <span className="text-xs text-theme-text-muted mb-1 block ml-0.5">{t('eventForm.endTime')}</span>
                <TimePickerInput
                  value={endTime}
                  onChange={setEndTime}
                  placeholder={formatTimeDisplay(DEFAULT_END_TIME)}
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
              </div>

              <div className="pt-2 border-t border-theme-stroke">
                <TimezonePickerInput
                  value={timezone}
                  onChange={setTimezone}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowDateTimeModal(false)}
              className="w-full mt-4 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              {t('eventForm.done')}
            </button>
          </div>
        </div>,
        document.body
      )}

      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
      />
    </>
  );
}
