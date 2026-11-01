# Travel Companion V17 — Local trip cards and actual footprints

Final plans automatically save as local trip cards. A new planning request reserves a separate identity, even for the same route. Changes remain versions of the same card; legacy current plans migrate without duplicating linked planning sessions.

Trip completion asks A (followed the plan) or B (adjust actual visited places). Only confirmed actual sightseeing becomes a footprint. Meals, rest, and planned trips do not light up the map. Dates remain optional; missing dates stay under “待补日期”. New actual places can be entered by name and city without asking the traveler to locate coordinates. Unmatched locations remain visible in the visit list.

Cards include title, destination, dates, day count, status, a cover slot, historical versions, and a reserved private-memory entry. Photo and memory upload is not implemented. By Year supports completed cards and preserves the existing imported public Travel Bank archive.

Each card offers an itinerary print view (browser Print → Save as PDF) and editable JSON backup. All-trip backup and merge import preserve unrelated trips, completion metadata, and chronological versions. JSON can contain preferences and AI discussions; printed itineraries exclude discussions and private memories. Preparation checklists are isolated per trip.

Data remains in this browser/device. There is no account, cloud synchronization, or automatic background travel tracking. Download backup before changing device or clearing browser data. A failed local storage write leaves prior cards intact and exposes a backup path.

Validation: 108 Node tests; mocked browser checks for migration, V2 in one card, selective actual completion, By Year, JSON downloads/import, print view, independent new-trip identity, and narrow-screen layout. Mocked AI checks do not verify live model output or mainland network reachability.

Frontend-only release. V16 Worker source and JSON recovery remain unchanged; external Cloudflare deployment must be performed separately with existing secrets preserved.
