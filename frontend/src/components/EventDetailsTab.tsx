import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Image as ImageIcon, FileText, Loader2, X, Square as SquareIcon, Trash2, Calendar, Play, DollarSign, Wand2, MessageCircle, Send, Check } from 'lucide-react';
import { IconInput } from './IconInput';
import { usePizza } from '../contexts/PizzaContext';
import { updateParty, uploadEventImage, deleteParty } from '../lib/supabase';
import { mintHostTelegramConnectToken, disconnectHostTelegram } from '../lib/api';
import { CustomUrlInput } from './CustomUrlInput';
import { LocationAutocomplete } from './LocationAutocomplete';
import { TimePickerInput } from './TimePickerInput';
import { TimezonePickerInput } from './TimezonePickerInput';
import { Checkbox } from './Checkbox';
import { getDateTimeInTimezone, parseDateTimeInTimezone, formatDateDisplay, formatTimeDisplay, formatTimezoneDisplay } from '../utils/dateUtils';
import { DonationSettings } from './DonationSettings';
import { HostsManager } from './HostsManager';
import { DescriptionEditor } from './DescriptionEditor';
import { triggerFlyerRegen } from './flyer/autoRegenFlyer';
import type { Party } from '../types';

export const EventDetailsTab: React.FC = () => {
  const { t } = useTranslation('host');
  const { party, loadParty, mergeParty, setParty } = usePizza();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [hostName, setHostName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timezone, setTimezone] = useState('');
  const [address, setAddress] = useState('');
  const [venueName, setVenueName] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [password, setPassword] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customUrlValid, setCustomUrlValid] = useState(true);
  const [customUrlError, setCustomUrlError] = useState<string | undefined>();
  const [eventImageUrl, setEventImageUrl] = useState('');
  const [eventImageFile, setEventImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [maxGuests, setMaxGuests] = useState('');
  const [requireApproval, setRequireApproval] = useState(false);
  const [limitGuests, setLimitGuests] = useState(false);
  const [hideGuests, setHideGuests] = useState(false);
  const [shareToUnlock, setShareToUnlock] = useState(false);
  const [shareTweetText, setShareTweetText] = useState('');
  const [nftEnabled, setNftEnabled] = useState(false);
  const [nftChain, setNftChain] = useState<string>('base');
  const [telegramGroup, setTelegramGroup] = useState('');
  const [turtleRolesEnabled, setTurtleRolesEnabled] = useState(false);

  // Host Telegram bot connection (sausage-24183)
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const isHostTelegramConnected = !!party?.hostTelegramChatId;

  const handleConnectHostTelegram = async () => {
    if (!party) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const response = await mintHostTelegramConnectToken(party.id);
      window.open(response.deeplink, '_blank', 'noopener');
    } catch (err: any) {
      setConnectError(t('partner:hostConnect.connectError') as string);
      console.error('Failed to mint host telegram connect token', err);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectHostTelegram = async () => {
    if (!party) return;
    setDisconnecting(true);
    try {
      await disconnectHostTelegram(party.id);
      await loadParty(party.inviteCode);
    } catch (err) {
      console.error('Failed to disconnect host telegram', err);
    } finally {
      setDisconnecting(false);
    }
  };

  const [showOptionalFields, setShowOptionalFields] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDateTimeModal, setShowDateTimeModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [toast, setToast] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // Pending lat/lng from LocationAutocomplete (fires before onPlaceSelected)
  const pendingCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  // Pending country from LocationAutocomplete (fires before onPlaceSelected)
  const pendingCountryRef = useRef<string | null>(null);
  // Pending city from LocationAutocomplete (fires before onPlaceSelected)
  const pendingCityRef = useRef<string | null>(null);
  // Pending Google place_id from LocationAutocomplete (set in onPlaceSelected just
  // before saveLocation is called; null when user is editing venue name only)
  const pendingPlaceIdRef = useRef<string | null>(null);

  // Track original values to detect changes
  const [originalValues, setOriginalValues] = useState<any>(null);

  // Load party data into form
  useEffect(() => {
    if (party) {
      const partyName = party.name || '';
      const partyHostName = party.hostName || '';
      const partyTimezone = party.timezone || (() => {
        try {
          return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch (error) {
          return 'UTC';
        }
      })();

      let partyStartDate = '';
      let partyStartTime = '';
      let partyEndDate = '';
      let partyEndTime = '';

      // Parse date and duration into start/end date/time fields
      // Convert from UTC to event's timezone so times display correctly
      if (party.date) {
        const startDateTime = new Date(party.date);

        // Use the event's timezone to get the correct local date/time
        const { dateStr: startDateStr, timeStr: startTimeStr } = getDateTimeInTimezone(
          startDateTime,
          partyTimezone
        );
        partyStartDate = startDateStr;
        partyStartTime = startTimeStr;

        // Calculate end date/time if duration exists
        if (party.duration) {
          const endDateTime = new Date(startDateTime.getTime() + party.duration * 60 * 60 * 1000);
          const { dateStr: endDateStr, timeStr: endTimeStr } = getDateTimeInTimezone(
            endDateTime,
            partyTimezone
          );
          partyEndDate = endDateStr;
          partyEndTime = endTimeStr;
        } else {
          partyEndDate = partyStartDate;
          partyEndTime = '';
        }
      }

      const partyAddress = party.address || '';
      const partyVenueName = party.venueName || null;
      const partyDescription = party.description || '';
      const partyPassword = party.password || '';
      const partyCustomUrl = party.customUrl || '';
      const partyEventImageUrl = party.eventImageUrl || '';
      const partyMaxGuests = party.maxGuests?.toString() || '';
      const partyLimitGuests = !!party.maxGuests;
      const partyHideGuests = party.hideGuests || false;
      const partyRequireApproval = party.requireApproval || false;
      const partyShareToUnlock = party.shareToUnlock || false;
      const partyShareTweetText = party.shareTweetText || '';
      const partyNftEnabled = party.nftEnabled || false;
      const partyNftChain = party.nftChain || 'base';
      const partyTelegramGroup = party.telegramGroup || '';
      const partyTurtleRolesEnabled = party.turtleRolesEnabled || false;

      // Set form values
      setName(partyName);
      setHostName(partyHostName);
      setTimezone(partyTimezone);
      setStartDate(partyStartDate);
      setStartTime(partyStartTime);
      setEndDate(partyEndDate);
      setEndTime(partyEndTime);
      setAddress(partyAddress);
      setVenueName(partyVenueName);
      setDescription(partyDescription);
      setPassword(partyPassword);
      setCustomUrl(partyCustomUrl);
      setEventImageUrl(partyEventImageUrl);
      setImagePreview(partyEventImageUrl || null);
      setMaxGuests(partyMaxGuests);
      setLimitGuests(partyLimitGuests);
      setHideGuests(partyHideGuests);
      setRequireApproval(partyRequireApproval);
      setShareToUnlock(partyShareToUnlock);
      setShareTweetText(partyShareTweetText);
      setNftEnabled(partyNftEnabled);
      setNftChain(partyNftChain);
      setTelegramGroup(partyTelegramGroup);
      setTurtleRolesEnabled(partyTurtleRolesEnabled);

      // Store original values
      setOriginalValues({
        name: partyName,
        hostName: partyHostName,
        startDate: partyStartDate,
        startTime: partyStartTime,
        endDate: partyEndDate,
        endTime: partyEndTime,
        timezone: partyTimezone,
        address: partyAddress,
        description: partyDescription,
        password: partyPassword,
        customUrl: partyCustomUrl,
        eventImageUrl: partyEventImageUrl,
        maxGuests: partyMaxGuests,
        limitGuests: partyLimitGuests,
        hideGuests: partyHideGuests,
        requireApproval: partyRequireApproval,
        shareToUnlock: partyShareToUnlock,
        shareTweetText: partyShareTweetText,
      });
    }
  }, [party]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Revoke previous preview URL if it exists
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview);
    }

    setImageError(null);

    if (!file.type.startsWith('image/')) {
      setImageError('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setImageError('Image must be less than 5MB');
      return;
    }

    // Validate square aspect ratio
    const img = new window.Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const aspectRatio = img.width / img.height;

      if (aspectRatio < 0.9 || aspectRatio > 1.1) {
        setImageError('Image must be square (1:1 aspect ratio)');
        setEventImageFile(null);
        setImagePreview(null);
        URL.revokeObjectURL(objectUrl);
        return;
      }

      setEventImageFile(file);
      setImagePreview(objectUrl);
      // Don't revoke URL - we need it for the preview
    };

    img.onerror = () => {
      setImageError('Failed to load image');
      URL.revokeObjectURL(objectUrl);
    };

    img.src = objectUrl;
  };

  const removeImage = () => {
    // Revoke the object URL if it exists to free memory
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview);
    }
    setEventImageFile(null);
    setImagePreview(null);
    setImageError(null);
    setEventImageUrl('');
  };

  // Check if any values have changed
  const hasChanges = () => {
    if (!originalValues) return false;

    return (
      name !== originalValues.name ||
      // hostName is no longer editable - it comes from the user account
      startDate !== originalValues.startDate ||
      startTime !== originalValues.startTime ||
      endDate !== originalValues.endDate ||
      endTime !== originalValues.endTime ||
      timezone !== originalValues.timezone ||
      address !== originalValues.address ||
      description !== originalValues.description ||
      password !== originalValues.password ||
      customUrl !== originalValues.customUrl ||
      eventImageUrl !== originalValues.eventImageUrl ||
      maxGuests !== originalValues.maxGuests ||
      limitGuests !== originalValues.limitGuests ||
      hideGuests !== originalValues.hideGuests ||
      eventImageFile !== null
    );
  };

  // Cancel changes and revert to original values
  const handleCancelChanges = () => {
    if (!originalValues) return;

    setName(originalValues.name);
    // hostName is not reset - it's display-only from user account
    setStartDate(originalValues.startDate);
    setStartTime(originalValues.startTime);
    setEndDate(originalValues.endDate);
    setEndTime(originalValues.endTime);
    setTimezone(originalValues.timezone);
    setAddress(originalValues.address);
    setDescription(originalValues.description);
    setPassword(originalValues.password);
    setCustomUrl(originalValues.customUrl);
    setEventImageUrl(originalValues.eventImageUrl);
    setImagePreview(originalValues.eventImageUrl || null);
    setMaxGuests(originalValues.maxGuests);
    setLimitGuests(originalValues.limitGuests);
    setHideGuests(originalValues.hideGuests);
    setEventImageFile(null);
    setImageError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!party) return;

    setSaving(true);
    setMessage(null);

    try {
      // Upload image if file is selected
      let imageUrl = eventImageUrl.trim() || undefined;
      if (eventImageFile) {
        try {
          imageUrl = await uploadEventImage(eventImageFile);
        } catch (err) {
          throw new Error(err instanceof Error ? err.message : 'Failed to upload image. Please ensure the storage bucket is configured or use an image URL instead.');
        }
      }

      // Calculate duration from start/end times
      // Use the event's timezone when parsing the entered date/time
      const tz = timezone || 'UTC';
      let calculatedDuration: number | null = null;
      let startDateTime: string | null = null;
      if (startDate && startTime && endDate && endTime) {
        const start = parseDateTimeInTimezone(startDate, startTime, tz);
        const end = parseDateTimeInTimezone(endDate, endTime, tz);
        const durationMs = end.getTime() - start.getTime();
        calculatedDuration = durationMs / (1000 * 60 * 60); // Convert to hours
        startDateTime = start.toISOString();
      } else if (startDate && startTime) {
        startDateTime = parseDateTimeInTimezone(startDate, startTime, tz).toISOString();
      }

      // Check if custom URL is valid (already validated by CustomUrlInput)
      if (customUrl.trim() && !customUrlValid) {
        throw new Error(customUrlError || 'Invalid custom URL');
      }

      // Update party in database
      // Note: host_name is now derived from User.name via user_id relationship
      const success = await updateParty(party.id, {
        name: name.trim(),
        date: startDateTime,
        duration: calculatedDuration,
        timezone: timezone || null,
        address: address.trim() || null,
        venue_name: venueName || null,
        description: description.trim() || null,
        password: password.trim() || null,
        custom_url: customUrl.trim() || null,
        event_image_url: imageUrl || null,
        max_guests: limitGuests && maxGuests ? parseInt(maxGuests, 10) : null,
        hide_guests: hideGuests,
        require_approval: requireApproval,
      });

      if (success) {
        setSaved(true);
        setToast(true);
        setTimeout(() => setToast(false), 2000);
        // Update original values to match current form state
        setOriginalValues({
          name: name.trim(),
          hostName: hostName.trim(),
          startDate,
          startTime,
          endDate,
          endTime,
          timezone,
          address: address.trim(),
          venueName: venueName,
          description: description.trim(),
          password: password.trim(),
          customUrl: customUrl.trim(),
          eventImageUrl: imageUrl || '',
          maxGuests,
          limitGuests,
          hideGuests,
          requireApproval,
        });
        // burrata-72104 v2: merge the bulk-saved fields into context so
        // sibling components see them without a refetch.
        const bulkPatch: Partial<Party> = {
          name: name.trim(),
          date: startDateTime,
          duration: calculatedDuration,
          timezone: timezone || null,
          address: address.trim() || null,
          venueName: venueName || null,
          description: description.trim() || null,
          password: password.trim() || null,
          customUrl: customUrl.trim() || null,
          eventImageUrl: imageUrl || null,
          maxGuests: limitGuests && maxGuests ? parseInt(maxGuests, 10) : null,
          hideGuests,
          requireApproval,
        };
        setParty(prev => prev ? { ...prev, ...bulkPatch } : prev);
        // Clear the image file since it's been uploaded
        setEventImageFile(null);
        // Reset saved state after a moment
        setTimeout(() => setSaved(false), 2000);
      } else {
        throw new Error('Failed to update party');
      }
    } catch (error) {
      console.error('Error updating party:', error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to update event details' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!party) return;

    setDeleting(true);
    setMessage(null);

    try {
      const success = await deleteParty(party.id);
      if (success) {
        setMessage({ type: 'success', text: 'Event deleted successfully' });
        // Redirect to home page after a short delay
        setTimeout(() => {
          navigate('/');
        }, 1500);
      } else {
        throw new Error('Failed to delete event');
      }
    } catch (error) {
      console.error('Error deleting party:', error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to delete event' });
      setDeleting(false);
    }
  };

  // Save individual field
  //
  // burrata-72104 (v2): accepts an optional camelCase `partyPatch` that gets
  // merged INTO the PizzaContext via `setParty(prev => ({...prev, ...patch}))`
  // after a successful save. This replaces v1's `loadParty()` everywhere, which
  // forced a full HostPage re-render and made tab-clicks-after-edit feel like
  // a page reload (same pain arugula-38633/33e631fe fixed in the pizza slider).
  //
  // The patch is typed `Partial<Party>` so TS catches misspelled camelCase
  // keys at compile time — source of truth for field names is `dbPartyToParty`
  // in PizzaContext.tsx.
  const saveField = async (
    fieldName: string,
    updates: Record<string, any>,
    partyPatch?: Partial<Party>,
  ) => {
    if (!party) return false;

    setSavingField(fieldName);
    setMessage(null);

    try {
      const success = await updateParty(party.id, updates);
      if (success) {
        setToast(true);
        setTimeout(() => setToast(false), 2000);
        // Update original values for the saved fields
        setOriginalValues((prev: any) => ({
          ...prev,
          ...Object.fromEntries(
            Object.entries(updates).map(([key, value]) => {
              // Map snake_case to camelCase for original values
              const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
              return [camelKey, value];
            })
          ),
        }));
        // burrata-72104 v2: merge the just-saved fields into context so
        // sibling tabs/components see the update without a full party refetch.
        if (partyPatch) {
          setParty(prev => prev ? { ...prev, ...partyPatch } : prev);
        }
        return true;
      } else {
        throw new Error('Failed to save');
      }
    } catch (error) {
      console.error(`Error saving ${fieldName}:`, error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : `Failed to save ${fieldName}` });
      return false;
    } finally {
      setSavingField(null);
    }
  };

  // Save event name
  const saveName = async () => {
    const trimmed = name.trim();
    const success = await saveField('name', { name: trimmed }, { name: trimmed });
    if (success) {
      setOriginalValues((prev: any) => ({ ...prev, name: trimmed }));
      // triggerFlyerRegen's second arg is its OWN flyer-URL refresh callback
      // (post-render); NOT a save-time refetch. Pass a forward-patched party
      // so the flyer renders with the just-saved name.
      if (party) triggerFlyerRegen({ ...party, name: trimmed }, mergeParty);
    }
  };

  // Save date/time
  const saveDateTime = async () => {
    let calculatedDuration: number | null = null;
    let startDateTime: string | null = null;

    // Use the event's timezone when parsing the entered date/time
    const tz = timezone || 'UTC';

    if (startDate && startTime && endDate && endTime) {
      const start = parseDateTimeInTimezone(startDate, startTime, tz);
      const end = parseDateTimeInTimezone(endDate, endTime, tz);
      const durationMs = end.getTime() - start.getTime();
      calculatedDuration = durationMs / (1000 * 60 * 60);
      startDateTime = start.toISOString();
    } else if (startDate && startTime) {
      startDateTime = parseDateTimeInTimezone(startDate, startTime, tz).toISOString();
    }

    const success = await saveField(
      'dateTime',
      {
        date: startDateTime,
        duration: calculatedDuration,
        timezone: timezone || null,
      },
      {
        date: startDateTime,
        duration: calculatedDuration,
        timezone: timezone || null,
      },
    );
    if (success) {
      setOriginalValues((prev: any) => ({
        ...prev,
        startDate,
        startTime,
        endDate,
        endTime,
        timezone,
      }));
      // burrata-72104 v2: dropped the explicit `loadParty(...)` here — the
      // saveField partyPatch above now merges the saved fields into context
      // in-place, avoiding the full HostPage re-render that v1 caused.
      if (party) {
        // Pass a party-shaped object with the just-saved timezone/date/duration so the
        // regen doesn't race the React context refresh and render with stale values.
        triggerFlyerRegen(
          { ...party, timezone: timezone || null, date: startDateTime, duration: calculatedDuration },
          mergeParty,
        );
      }
    }
  };

  // Save description
  const saveDescription = async () => {
    const trimmed = description.trim();
    const success = await saveField(
      'description',
      { description: trimmed || null },
      { description: trimmed || null },
    );
    if (success) {
      setOriginalValues((prev: any) => ({ ...prev, description: trimmed }));
    }
  };

  // Save location
  const saveLocation = async (newAddress: string, newVenueName: string | null) => {
    const coords = pendingCoordsRef.current;
    pendingCoordsRef.current = null;
    const country = pendingCountryRef.current;
    pendingCountryRef.current = null;
    const city = pendingCityRef.current;
    pendingCityRef.current = null;
    // Only include place_id in the payload when a new place was actually picked
    // from the autocomplete dropdown — otherwise leave it untouched on the server
    const placeId = pendingPlaceIdRef.current;
    pendingPlaceIdRef.current = null;
    const trimmedAddress = newAddress.trim() || null;
    // camelCase patch mirrors the DB payload — only includes fields that the
    // DB write actually touches (placeId is conditional, matching the payload)
    const partyPatch: Partial<Party> = {
      address: trimmedAddress,
      venueName: newVenueName || null,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
      country: country || null,
      city: city || null,
      ...(placeId !== null && { placeId }),
    };
    const success = await saveField(
      'location',
      {
        address: trimmedAddress,
        venue_name: newVenueName || null,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        country: country || null,
        city: city || null,
        ...(placeId !== null && { place_id: placeId }),
      },
      partyPatch,
    );
    if (success) {
      setOriginalValues((prev: any) => ({
        ...prev,
        address: newAddress.trim(),
        venueName: newVenueName,
      }));
      // Forward-patch party for flyer regen so it uses the just-saved values
      // (FlyerRegenData.venueName / .address come from Party).
      if (party) {
        triggerFlyerRegen(
          { ...party, address: trimmedAddress, venueName: newVenueName || null },
          mergeParty,
        );
      }
    }
  };

  // Save image
  const saveImage = async () => {
    let imageUrl = eventImageUrl.trim() || undefined;
    if (eventImageFile) {
      try {
        imageUrl = await uploadEventImage(eventImageFile);
      } catch (err) {
        setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to upload image' });
        return;
      }
    }

    const success = await saveField(
      'image',
      { event_image_url: imageUrl || null },
      { eventImageUrl: imageUrl || null },
    );
    if (success) {
      setOriginalValues((prev: any) => ({ ...prev, eventImageUrl: imageUrl || '' }));
      setEventImageFile(null);
    }
  };

  // Save options (checkbox changes)
  //
  // burrata-72104 v2: callers pass both the DB-shape snake_case payload AND a
  // matching camelCase Partial<Party> patch — the second arg flows into
  // setParty so sibling consumers see the change without a refetch. TS will
  // catch misspelled camelCase keys here.
  const saveOptions = async (
    updates: Record<string, any>,
    partyPatch: Partial<Party>,
  ) => {
    await saveField('options', updates, partyPatch);
  };

  // Check if name has changed
  const nameHasChanged = () => {
    if (!originalValues) return false;
    return name.trim() !== originalValues.name;
  };

  if (!party) {
    return <div className="card p-6 text-theme-text-secondary">No party loaded</div>;
  }

  return (
    <>
    {toast && (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#39d98a]/90 text-black text-sm font-medium px-4 py-2 rounded-xl shadow-lg animate-fade-in">
        Event updated
      </div>
    )}
    <div className="card p-8">
      <div className="space-y-3">
        {/* Name */}
        <div className="relative">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Party Name *"
            className={`w-full ${nameHasChanged() ? 'pr-20' : ''}`}
          />
          {nameHasChanged() && (
            <button
              type="button"
              onClick={saveName}
              disabled={savingField === 'name'}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              {savingField === 'name' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                'Save'
              )}
            </button>
          )}
        </div>

        {/* Address */}
        <div className="relative">
          <LocationAutocomplete
            value={venueName ? `${venueName}, ${address}` : address}
            onChange={(newAddress) => {
              setVenueName(null);
              setAddress(newAddress);
            }}
            onVenueNameChange={(newVenueName) => {
              setVenueName(newVenueName);
            }}
            onTimezoneChange={setTimezone}
            onLocationSelected={(loc) => {
              pendingCoordsRef.current = loc;
            }}
            onCitySelected={(cityData) => {
              pendingCountryRef.current = cityData.country || null;
              pendingCityRef.current = cityData.cityName || null;
            }}
            onPlaceSelected={(newAddress, newVenueName, placeId) => {
              pendingPlaceIdRef.current = placeId;
              saveLocation(newAddress, newVenueName);
            }}
            placeholder="Add Event Location"
          />
          {venueName && (
            <button
              type="button"
              onClick={() => {
                setVenueName(null);
                saveLocation(address, null);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors z-10"
              title="Remove venue name"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Change Date Button */}
        <button
          type="button"
          onClick={() => setShowDateTimeModal(true)}
          className="w-full bg-theme-surface border border-theme-stroke rounded-xl p-4 text-left hover:bg-theme-surface-hover transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar size={18} className="text-theme-text-muted flex-shrink-0" />
              {startDate && startTime && endDate && endTime ? (
                <div>
                  <div className="text-theme-text font-medium">
                    {formatDateDisplay(startDate, timezone)}
                  </div>
                  <div className="text-theme-text-secondary text-sm mt-1">
                    {formatTimeDisplay(startTime)} — {formatTimeDisplay(endTime)} {formatTimezoneDisplay(timezone)}
                  </div>
                </div>
              ) : startDate ? (
                <div>
                  <div className="text-theme-text font-medium">
                    {formatDateDisplay(startDate, timezone)}
                  </div>
                  <div className="text-theme-text-muted text-sm mt-1">Time TBD — Click to set event time</div>
                </div>
              ) : (
                <div>
                  <span className="text-theme-text-secondary">No date set</span>
                  <div className="text-theme-text-muted text-sm mt-1">Click to set event time</div>
                </div>
              )}
            </div>
          </div>
        </button>

        {/* Description */}
        <button
          type="button"
          onClick={() => setShowDescriptionModal(true)}
          className="w-full bg-theme-surface border border-theme-stroke rounded-xl p-4 text-left hover:bg-theme-surface-hover transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <FileText size={18} className="text-theme-text-muted flex-shrink-0" />
              {description ? (
                <p className="text-theme-text line-clamp-2">{description}</p>
              ) : (
                <span className="text-theme-text-secondary">Add Description</span>
              )}
            </div>
          </div>
        </button>

        {/* Event Image - Change Image Button */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowImageModal(true)}
            className="flex-1 bg-theme-surface border border-theme-stroke rounded-xl p-4 text-left hover:bg-theme-surface-hover transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ImageIcon size={18} className="text-theme-text-muted flex-shrink-0" />
                {imagePreview ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={imagePreview}
                      alt="Event flyer preview"
                      className="w-12 h-12 rounded-lg object-cover border border-theme-stroke-hover"
                    />
                    <span className="text-theme-text font-medium">Event Image</span>
                  </div>
                ) : (
                  <div>
                    <span className="text-theme-text-secondary">No image set</span>
                    <div className="text-theme-text-muted text-sm mt-1">Click to add event image</div>
                  </div>
                )}
              </div>
            </div>
          </button>
          {party?.eventType === 'gpp' && (
            <button
              type="button"
              onClick={() => navigate(`/host/${party.inviteCode}/flyer`)}
              className="flex flex-col items-center justify-center gap-1 px-4 bg-theme-surface border border-theme-stroke rounded-xl hover:bg-theme-surface-hover transition-colors"
            >
              <Wand2 size={18} className="text-theme-text-muted" />
              <span className="text-xs text-theme-text-secondary whitespace-nowrap">Generate Flyer</span>
            </button>
          )}
        </div>
        {imageError && (
          <p className="text-xs text-red-400 mt-1">{imageError}</p>
        )}

        {/* Options Section */}
        <div>
          <button
            type="button"
            onClick={() => setShowOptionalFields(!showOptionalFields)}
            className="w-full flex items-center justify-between p-4 bg-theme-surface hover:bg-theme-surface-hover border border-theme-stroke rounded-xl transition-colors"
          >
            <span className="text-sm font-medium text-theme-text">Options</span>
            {showOptionalFields ? (
              <svg className="w-5 h-5 text-theme-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-theme-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>

          {showOptionalFields && (
            <div className="space-y-3 border-l-2 border-theme-stroke pl-4 mt-3">
              <Checkbox
                checked={requireApproval}
                onChange={() => {
                  const newValue = !requireApproval;
                  setRequireApproval(newValue);
                  saveOptions({ require_approval: newValue }, { requireApproval: newValue });
                }}
                label="Require Approval"
              />

              <Checkbox
                checked={hideGuests}
                onChange={() => {
                  const newValue = !hideGuests;
                  setHideGuests(newValue);
                  saveOptions({ hide_guests: newValue }, { hideGuests: newValue });
                }}
                label="Hide Guests"
              />

              <Checkbox
                checked={limitGuests}
                onChange={() => {
                  const newValue = !limitGuests;
                  setLimitGuests(newValue);
                  if (!newValue) {
                    // If unchecking, clear max guests and save
                    setMaxGuests('');
                    saveOptions({ max_guests: null }, { maxGuests: null });
                  }
                }}
                label="Limit Guests"
              />

              {limitGuests && (
                <div className="relative">
                  <IconInput
                    icon={User}
                    type="number"
                    min={1}
                    value={maxGuests}
                    onChange={(e) => setMaxGuests(e.target.value)}
                    onBlur={() => {
                      if (maxGuests) {
                        const parsed = parseInt(maxGuests, 10);
                        saveOptions({ max_guests: parsed }, { maxGuests: parsed });
                      }
                    }}
                    placeholder="Capacity"
                  />
                </div>
              )}

              <div className="relative">
                <IconInput
                  icon={Lock}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => {
                    const trimmed = password.trim() || null;
                    saveOptions({ password: trimmed }, { password: trimmed });
                  }}
                  placeholder="Event Password"
                  autoComplete="new-password"
                />
              </div>
              {password && (
                <Checkbox
                  checked={shareToUnlock}
                  onChange={() => {
                    const newValue = !shareToUnlock;
                    setShareToUnlock(newValue);
                    saveOptions({ share_to_unlock: newValue }, { shareToUnlock: newValue });
                    if (!newValue) {
                      setShareTweetText('');
                      saveOptions(
                        { share_to_unlock: false, share_tweet_text: null },
                        { shareToUnlock: false, shareTweetText: null },
                      );
                    }
                  }}
                  label="Share to Unlock"
                />
              )}
              {password && shareToUnlock && (
                <IconInput
                  icon={Lock}
                  multiline
                  value={shareTweetText}
                  onChange={(e) => setShareTweetText(e.target.value)}
                  onBlur={() => {
                    const trimmed = shareTweetText.trim() || null;
                    saveOptions({ share_tweet_text: trimmed }, { shareTweetText: trimmed });
                  }}
                  placeholder="Custom tweet text (optional)"
                />
              )}

              <CustomUrlInput
                value={customUrl}
                onChange={setCustomUrl}
                currentPartyId={party?.id}
                onValidationChange={(isValid, error) => {
                  setCustomUrlValid(isValid);
                  setCustomUrlError(error);
                }}
                onBlur={() => {
                  if (customUrlValid) {
                    const trimmed = customUrl.trim() || null;
                    saveOptions({ custom_url: trimmed }, { customUrl: trimmed });
                  }
                }}
              />

              <IconInput
                icon={MessageCircle}
                type="url"
                value={telegramGroup}
                onChange={(e) => setTelegramGroup(e.target.value)}
                onBlur={() => {
                  const trimmed = telegramGroup.trim() || null;
                  saveOptions({ telegram_group: trimmed }, { telegramGroup: trimmed });
                }}
                placeholder="Telegram group link (e.g. https://t.me/+abc123)"
              />

              {/* Host Telegram bot connection (sausage-24183) */}
              <div>
                {!isHostTelegramConnected ? (
                  <>
                    <button
                      type="button"
                      onClick={handleConnectHostTelegram}
                      disabled={connecting}
                      className="flex items-center gap-2 bg-[#E52828] hover:bg-[#cc2222] disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                    >
                      {connecting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      {t('partner:hostConnect.buttonConnect')}
                    </button>
                    <p className="text-xs text-white/40 mt-1.5">
                      {t('partner:hostConnect.helperConnect')}
                    </p>
                    {connectError && (
                      <p className="text-xs text-red-400 mt-1.5">{connectError}</p>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <div className="flex items-center gap-2 text-sm text-green-500">
                      <Check size={16} />
                      <span>{t('partner:hostConnect.connected')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleDisconnectHostTelegram}
                      disabled={disconnecting}
                      className="text-xs text-white/40 hover:text-white/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {disconnecting ? t('partner:hostConnect.disconnecting') : t('partner:hostConnect.disconnect')}
                    </button>
                  </div>
                )}
              </div>

              <Checkbox
                checked={turtleRolesEnabled}
                onChange={() => {
                  const newValue = !turtleRolesEnabled;
                  setTurtleRolesEnabled(newValue);
                  saveOptions({ turtle_roles_enabled: newValue }, { turtleRolesEnabled: newValue });
                }}
                label="Ask RSVP Role (Turtle)"
              />

              {/* NFT Settings — hidden for GPP events (managed from /admin) */}
              {party?.eventType !== 'gpp' && (
                <>
                  <Checkbox
                    checked={nftEnabled}
                    onChange={() => {
                      const newValue = !nftEnabled;
                      setNftEnabled(newValue);
                      if (newValue && !nftChain) {
                        setNftChain('base');
                        saveOptions(
                          { nft_enabled: newValue, nft_chain: 'base' },
                          { nftEnabled: newValue, nftChain: 'base' },
                        );
                      } else {
                        saveOptions({ nft_enabled: newValue }, { nftEnabled: newValue });
                      }
                    }}
                    label="Mint Attendance NFT"
                  />
                  {nftEnabled && (
                    <div className="flex gap-2">
                      {(['base', 'monad'] as const).map((chain) => (
                        <button
                          key={chain}
                          type="button"
                          onClick={() => {
                            setNftChain(chain);
                            saveOptions({ nft_chain: chain }, { nftChain: chain });
                          }}
                          className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                            nftChain === chain
                              ? 'bg-[#ff393a] text-white'
                              : 'bg-theme-surface-hover text-theme-text-secondary hover:bg-theme-surface-hover'
                          }`}
                        >
                          {chain === 'base' ? 'Base' : 'Monad'}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Donations Section */}
        <DonationSettings />

        {/* Hosts Section */}
        <HostsManager
          partyId={party.id}
          hostName={hostName}
          initialCoHosts={party.coHosts || []}
        />

        {/* Error Message */}
        {message && message.type === 'error' && (
          <div className="p-3 rounded-xl text-sm bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a]">
            {message.text}
          </div>
        )}

        {/* Cancel Event Button */}
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={deleting}
          className="w-full bg-[#ff393a]/10 hover:bg-[#ff393a]/20 border border-[#ff393a]/30 text-[#ff393a] hover:text-[#ff5a5b] font-medium px-6 py-3 rounded-xl transition-all flex items-center justify-center gap-2"
        >
          <Trash2 size={18} />
          {t('eventDetails.deleteEvent')}
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-theme-text mb-3">{t('eventDetails.deleteConfirmTitle')}</h2>
            <p className="text-theme-text-secondary mb-6">
              {t('eventDetails.deleteConfirmMessage')}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 btn-secondary"
              >
                {t('eventDetails.cancel')}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium px-6 py-3 rounded-xl transition-all flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={18} />
                    {t('eventDetails.deleteConfirmButton')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Mobile Date/Time Modal */}
      {showDateTimeModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70" onClick={async () => {
          if (
            originalValues && (
              startDate !== originalValues.startDate ||
              startTime !== originalValues.startTime ||
              endDate !== originalValues.endDate ||
              endTime !== originalValues.endTime ||
              timezone !== originalValues.timezone
            )
          ) {
            await saveDateTime();
          }
          setShowDateTimeModal(false);
        }}>
          <div className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-theme-text mb-4">Event Time</h2>

            <div className="space-y-3">
              {/* Start Date */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Play size={14} className="text-theme-text-muted" />
                  <span className="text-xs text-theme-text-muted">Start Date</span>
                </div>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (!endDate) setEndDate(e.target.value);
                  }}
                  disabled={party?.eventType === 'gpp'}
                  onClick={(e) => { if (party?.eventType !== 'gpp') (e.target as HTMLInputElement).showPicker?.(); }}
                  className={`w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] ${party?.eventType === 'gpp' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  style={{ colorScheme: 'dark' }}
                />
              </div>

              {/* Start Time */}
              <div>
                <span className="text-xs text-theme-text-muted mb-1 block ml-0.5">Start Time</span>
                <TimePickerInput
                  value={startTime}
                  onChange={setStartTime}
                  placeholder="12:00 PM"
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
              </div>

              {/* End Date */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <SquareIcon size={12} className="text-theme-text-muted" />
                  <span className="text-xs text-theme-text-muted">End Date</span>
                </div>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || undefined}
                  max={party?.eventType === 'gpp' ? '2026-05-23' : undefined}
                  onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] cursor-pointer"
                  style={{ colorScheme: 'dark' }}
                />
              </div>

              {/* End Time */}
              <div>
                <span className="text-xs text-theme-text-muted mb-1 block ml-0.5">End Time</span>
                <TimePickerInput
                  value={endTime}
                  onChange={setEndTime}
                  placeholder="1:00 PM"
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
              </div>

              {/* Timezone */}
              <div className="pt-2 border-t border-theme-stroke">
                <TimezonePickerInput
                  value={timezone}
                  onChange={setTimezone}
                />
              </div>
            </div>

            {/* Done Button */}
            <button
              type="button"
              onClick={async () => {
                await saveDateTime();
                setShowDateTimeModal(false);
              }}
              disabled={savingField === 'dateTime'}
              className="w-full mt-4 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {savingField === 'dateTime' ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving...
                </>
              ) : (
                'Done'
              )}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Image Modal */}
      {showImageModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70" onClick={() => setShowImageModal(false)}>
          <div className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-theme-text mb-4">Event Image</h2>

            <div className="space-y-4">
              {/* Current Image Preview */}
              {imagePreview && (
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
                    <X size={16} />
                  </button>
                </div>
              )}

              {/* File Upload */}
              {!imagePreview && (
                <div className="relative">
                  <input
                    type="file"
                    id="eventImageModal"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                  />
                  <label
                    htmlFor="eventImageModal"
                    className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-theme-stroke-hover rounded-xl cursor-pointer hover:border-[#ff393a]/50 transition-colors bg-theme-surface hover:bg-theme-surface-hover"
                  >
                    <svg className="w-8 h-8 text-theme-text-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-sm text-theme-text-secondary">Click to upload square image</span>
                    <span className="text-xs text-theme-text-muted mt-1">Max 5MB • 1:1 aspect ratio</span>
                  </label>
                </div>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-theme-surface-hover"></div>
                <span className="text-xs text-theme-text-muted">OR</span>
                <div className="flex-1 h-px bg-theme-surface-hover"></div>
              </div>

              {/* Image URL Input */}
              <div className="relative">
                <ImageIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
                <input
                  type="url"
                  value={eventImageUrl}
                  onChange={(e) => {
                    setEventImageUrl(e.target.value);
                    setImagePreview(e.target.value);
                  }}
                  placeholder="Square Image URL"
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] !pl-10"
                />
              </div>

              {imageError && (
                <p className="text-xs text-red-400">{imageError}</p>
              )}
            </div>

            {/* Done Button */}
            <button
              type="button"
              onClick={async () => {
                await saveImage();
                setShowImageModal(false);
              }}
              disabled={savingField === 'image'}
              className="w-full mt-4 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {savingField === 'image' ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving...
                </>
              ) : (
                'Done'
              )}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Description Modal */}
      {showDescriptionModal && (
        <DescriptionEditor
          value={description}
          onChange={setDescription}
          onSave={async () => {
            await saveDescription();
            setShowDescriptionModal(false);
          }}
          onClose={() => setShowDescriptionModal(false)}
          saving={savingField === 'description'}
          partyId={party!.id}
        />
      )}

    </div>
    </>
  );
};
