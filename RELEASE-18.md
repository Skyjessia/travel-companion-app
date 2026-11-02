# V18 — On-road continuity

Keep the overseas homepage entry, By Day button, planning flow and Travel Bank. The assistant opens with “随时问，随时在” expanded. Preset questions wrap instead of requiring horizontal scrolling. A day selector and explicit current-place context carry the saved itinerary into every preset and custom question. Mobile puts the conversation first; desktop retains the two-column companion layout.

Sightseeing cards include category-based general photo advice (clearly labeled as general, not verified viewpoints or lighting forecasts), an observation prompt, and on-demand AI background/photo questions. Daily itinerary links open the matching day/place. An explicit “这站已走完” flag guides same-day assistance; it does not create actual footprints.

Rain, fatigue and late-start actions request two structured simplification proposals through the existing V16 chat endpoint. Proposals can only retain/remove existing stop IDs in original order, preserve completed, food and fixed segments, and never change times, other dates or identities. Users choose before application, may undo, and adjustments create version snapshots. Stale or invalid proposals leave the saved itinerary unchanged. Alternative places remain advice in chat pending user review, not automatic inserts. No live GPS, weather, routing, verified photography positions or ticket availability is implied.

No Worker update is required. AI calls remain online services and may fail; the UI keeps the itinerary usable and provides retry. Data is still browser-local, with V17 backups retained. This release does not implement the domestic mini-program or remove overseas archives.

Validation: 116 Node tests pass, including 8 focused on completed-stop preservation, fixed segments, stale responses, invalid IDs and strict JSON. Mock browser checks cover selection, confirm/undo, day-context changes and 320px layout. Live model answer quality and mainland network reachability are not proven by mocks.
