import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPassengerStopNote,
  formatPassengerStopLabel,
  passengerStopIdentity,
  PUBLIC_PASSENGER_APP_URL,
  publicPassengerUrl,
} from "./index";

test("uses a verified stop label instead of route-driving narrative", () => {
  const raw = "Beginning of Route, Right on Jackson Avenue, left on Washington Avenue goes along Washington Avenue, leaves New Square.";
  assert.equal(formatPassengerStopLabel(raw, {
    verifiedLabel: "Jackson Avenue & Washington Avenue",
  }), "Jackson Avenue & Washington Avenue");
});

test("extracts only two streets explicitly present in an unmatched narrative", () => {
  assert.equal(
    formatPassengerStopLabel("Right on Jackson Avenue, then left on Washington Avenue and goes along Washington Avenue"),
    "Jackson Avenue & Washington Avenue",
  );
});

test("passenger stop identity is stable across run-specific API ids", () => {
  const first = { id: "official-run-a-1", kind: "pickup" as const, label: "Main St. & Maple Ave", lat: 41.1234561, lng: -74.1234561 };
  const second = { id: "official-run-b-4", kind: "pickup" as const, label: "Main St & Maple Ave", lat: 41.1234562, lng: -74.1234562 };
  assert.equal(passengerStopIdentity(first), passengerStopIdentity(second));
  assert.notEqual(passengerStopIdentity(first), passengerStopIdentity({ ...second, kind: "dropoff" }));
});

test("public passenger links use the verified deployed passenger route", () => {
  assert.equal(PUBLIC_PASSENGER_APP_URL, "https://coach-passenger-display.replit.app/passengers");
  assert.equal(
    publicPassengerUrl(new URLSearchParams({ run: "225~21:30:00" })),
    "https://coach-passenger-display.replit.app/passengers?run=225%7E21%3A30%3A00",
  );
});

test("does not invent a cross street for a landmark stop", () => {
  assert.equal(
    formatPassengerStopLabel("Route 306 across Ohr Sameach"),
    "Route 306",
  );
});

test("retains mid-block shelters without assigning a nearby corner", () => {
  for (const street of ["Monsey Blvd", "Monsey Boulevard"]) {
    assert.equal(formatPassengerStopLabel(`On ${street} at the bus shelter.`),
      "Monsey Boulevard");
  }
  assert.equal(formatPassengerStopLabel("Monsey Boulevard"), "Monsey Boulevard");
  assert.equal(formatPassengerStopLabel("Monsey Blvd corner Maple Ave at the bus shelter."),
    "Monsey Boulevard & Maple Avenue");
  assert.equal(formatPassengerStopLabel("On Maple Ave in front of the nursing home."),
    "Maple Avenue");
});

test("formats full geocoder intersections and hides full house addresses", () => {
  assert.equal(
    formatPassengerStopLabel("18th Avenue, 49th Street, Borough Park, Brooklyn, New York, United States"),
    "18th Avenue & 49th Street",
  );
  assert.equal(
    formatPassengerStopLabel("1214 48th Street, Borough Park, Brooklyn, New York, United States"),
    "Boro Park",
  );
});

test("strips pickup timing without changing the location", () => {
  assert.equal(
    formatPassengerStopLabel("Stop 1: Starts on Viola Road & Union Road 15 minutes prior to schedule time."),
    "Viola Road & Union Road",
  );
});

test("removes leftover corner and conjunction words from published intersections", () => {
  assert.equal(
    formatPassengerStopLabel("Stops on Route 59 & corner West Street."),
    "Route 59 & West Street",
  );
  assert.equal(
    formatPassengerStopLabel("This bus drops off in Manhattan at 34th St & and 9th Ave."),
    "34th Street & 9th Avenue",
  );
});

test("separates official passenger notes from the main stop label", () => {
  assert.equal(extractPassengerStopNote(
    "Route 306 across Ohr Sameach.", "Route 306 & Viola Road",
  ), "across Ohr Sameach");
  assert.equal(extractPassengerStopNote(
    "On Maple Ave in front of the nursing home.", "Maple Avenue",
  ), "in front of the nursing home");
  assert.equal(extractPassengerStopNote(
    "On Monsey Blvd at the bus shelter 5 minutes before scheduled time.", "Monsey Boulevard",
  ), "bus shelter • 5 minutes before scheduled time");
  assert.equal(extractPassengerStopNote(
    "Right on Jackson Avenue, then turns right and goes along Washington Avenue.",
    "Jackson Avenue & Washington Avenue",
  ), undefined);
});

test("retains audited landmark, side, parenthetical, and timing variants", () => {
  const cases = [
    ["On 306 across Ohr Sameach (corner Viola Road).", "Route 306 & Viola Road", "across Ohr Sameach"],
    ["Robert Pitt and Route 59 side of Monsey Hub.", "Robert Pitt & Route 59", "side of Monsey Hub"],
    ["Bakertown Road front of Park and Ride.", "Bakertown Road", "front of Park and Ride"],
    ["Old Nyack Turnpike across South Madison (Chaya Sarah hall).", "Old Nyack Turnpike & South Madison", "across South Madison • Chaya Sarah hall"],
    ["Bates (Monsey Glatt).", "Bates", "Monsey Glatt"],
    ["At scheduled time - Bais Medrash.", "Bais Medrash", "At scheduled time"],
    ["Starts 10 minutes before schedule on Bedford Avenue corner Wallabout Street.", "Bedford Avenue & Wallabout Street", "10 minutes before schedule"],
  ] as const;
  for (const [raw, label, note] of cases) {
    assert.equal(extractPassengerStopNote(raw, label), note, raw);
  }
  assert.equal(formatPassengerStopLabel("At scheduled time - Bais Medrash."), "Bais Medrash");
  assert.equal(formatPassengerStopLabel("On Kennedy across Astor."), "Kennedy & Astor");
  assert.equal(
    formatPassengerStopLabel("Old Nyack Turnpike across South Madison (Chaya Sarah hall)."),
    "Old Nyack Turnpike & South Madison",
  );
});