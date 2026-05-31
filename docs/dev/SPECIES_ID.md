# Species ID from photo — scoping doc

**Goal:** User takes a photo (or selects one from gallery) → app suggests
the top 1-3 most likely species. Reduces the friction of logging a catch
to "take photo + tap species".

**Status:** Not started. Foundation for a future implementation session.

## Three approaches, ranked

### A) On-device CoreML (best fit, hardest to ship)

**Pros:**
- Free at runtime — no API costs
- Works offline
- Privacy-safe (photo never leaves the device)
- Fast (<1s inference on modern iPhones)

**Cons:**
- Need to train a model
- Model file is 5-15 MB added to bundle
- iOS-only out of the box (Android needs separate TFLite model)

**Effort:** ~1-2 weeks
1. Curate a dataset of ~500 photos per Bulgarian species (top 20-30)
   - Start: scrape public Ribolov catches with species labels (already
     have this data in `publicCatches`!)
   - Augment: angler community contributions, kapka.bg
   - Target: 15-20k labeled images across the top 30 species
2. Train a MobileNetV2 / EfficientNet-Lite model on Colab (~2 days)
3. Convert to CoreML (`coremltools`) and TFLite for Android
4. Bundle with app
5. Build inference UI: photo → progress → top-3 suggestions

### B) Cloud Vision API (fastest to ship, recurring cost)

**Pros:**
- 1-2 days to ship
- Works for all species, not just our trained ones
- No bundle size penalty

**Cons:**
- $1.50 per 1000 calls. At 4000 catches/day × 30 days = 120k calls/month
  = **~$180/month**. Burns through our cost budget.
- Requires internet
- Sends photos to Google

**Effort:** ~2-3 days
1. Cloud Function wrapper around Vision API + Bulgarian species
   filter map (Vision returns English "European carp" → we map to
   "Шаран")
2. Client UI

### C) Wait for users to submit, ship later

**Pros:**
- Free now
- Have time to collect labeled data via in-app submissions

**Cons:**
- No feature today

## Recommendation

**Phase 1 (this quarter):** A few months of in-app data collection via
the existing `publicCatches.speciesName + photoUri` pairs. Quietly
build the dataset.

**Phase 2 (next quarter):** Train the CoreML model once we have
~10k labeled images. Ship as a "Beta" feature with an opt-in toggle.

**Phase 3:** Polish accuracy, expand species coverage, add confidence
thresholds and "съответства ли?" feedback loop.

## Implementation sketch for Phase 2

### New files
- `src/services/speciesId.ts` — wraps the CoreML/TFLite native module
- `src/components/SpeciesSuggestionCard.tsx` — top-3 results with confidence bars
- `assets/models/species.mlmodel` (~12 MB CoreML)
- `assets/models/species.tflite` (~10 MB TFLite for Android)

### Wiring
- AddCatchScreen: after photo picker, run inference in background
- Pre-select the top-1 species if confidence > 0.6
- Show "Предложения от AI:" row with 3 chips below the species picker
- Tap a chip to accept; "не съответства" feedback loop sends a flag
  to Firestore for model retraining

### Cost
- Bundle size +12 MB (iOS) / +10 MB (Android)
- Inference: ~$0
- Retraining ongoing: 2-4 days of work per quarter (Colab is free)

## Why we're not doing this in the current session

Multi-day ML project that needs either:
- Cloud API budget (~$180/month at scale — user wants free)
- Dataset curation + model training (2 weeks)

Open as a tracked epic.

## Adjacent useful improvements (smaller, doable)

While we wait on full species ID, these reduce the same friction:
- **Recent species shortcut:** Pre-fill the species picker with the
  user's last-used species. ~30 min, big quality-of-life win.
- **"Same as previous catch" button:** Single-tap to copy bait /
  species / location from the last catch. ~1h.
- **Voice input for species:** Tap mic, say "шаран", autofill.
  Uses `expo-speech-recognition` or system voice keyboard. ~3h.
