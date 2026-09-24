# Coach Display Integrations

This document outlines the integration points required to transition the Coach Display MVP to a production-ready state using real telemetry and data APIs.

## 1. GPS & Telemetry Provider
The display now subscribes to the browser/device Geolocation API and falls back to the next route stop when GPS is unavailable.
**Production requirement:** Configure the onboard browser to permit location access, or replace the browser subscription with the vehicle gateway feed.
- **Data shape:** `lat`, `lng`, `speed`, `heading`.
- **Implementation:** Replace the mock hook with a WebSocket connection to the local gateway (e.g., `ws://192.168.1.1/telemetry`) to stream coordinates at ~1Hz.
- **Route Progress:** Integrate with an ETA engine (like Google Maps Distance Matrix or a transit-specific routing engine) to compute time-to-next-stop based on current telemetry.

## 2. Weather Provider
`useWeatherData` fetches current conditions from Open-Meteo for the live coach position, or for the destination while GPS is unavailable.
- **Caching:** Coordinates are rounded, refreshes run every 15 minutes, and the last successful response persists for offline/stale display.
- **Failure behavior:** The display retains a readable last-known or unavailable state while route and safety information continue working.

## 3. Traffic & Delay
`useTrafficData` refreshes every minute and combines live coach speed with the route's current ETA-versus-schedule delay.
- A production fleet traffic provider can replace this calculation without changing the passenger views.
- Provider/GPS failures retain route and safety UI and clearly label stale or offline conditions.

### Production traffic provider
The passenger UI includes a traffic provider boundary (`useTrafficData`). Accurate live road delays require a runtime traffic API such as TomTom Traffic.
- **Secret:** Configure `TOMTOM_API_KEY` in Replit Secrets.
- **Failure behavior:** Keep the last successful condition and mark it stale; never hide route or safety information.

## 4. Operations API (Settings & Announcements)
Currently mocked via `localStorage` (zustand persist).
**Requirement:** Allow fleet managers in a central office to push settings and announcements to the coach.
- **Implementation:** The onboard server should poll or maintain an SSE/MQTT connection to the fleet management backend to sync `CoachSettings`.
- **Operator Override:** The local tablet (`/operator`) changes should sync back to the cloud, or act as a temporary local override.

## 5. Transit Data / Connection Provider (Future)
**Requirement:** Show connecting trains/flights at the destination.
- **Implementation:** Use GTFS-RT or specific transit operator APIs when approaching a major hub (e.g., National Rail API in the UK).

## Data Efficiency
In a mobile environment, bandwidth is limited and connections drop.
- All assets (fonts, images) must be bundled (done in this MVP).
- The display must gracefully handle offline periods (`connectivity: 'offline'`) by relying on dead-reckoning for ETAs or simply pausing ETA updates until connection is restored.
