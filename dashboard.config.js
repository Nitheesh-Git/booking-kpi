export const properties = [
  {
    id: "olympic-paddington",
    name: "Olympic Hotel Paddington",
    bookingUrl: "https://www.booking.com/hotel/au/olympic-paddington.html",
  },
  {
    id: "potts-point",
    name: "Potts Point",
    bookingUrl:
      "https://www.booking.com/hotel/au/venus-potts-point-sydney.html",
  },
  {
    id: "central-sydney",
    name: "Central Sydney",
    bookingUrl: "https://www.booking.com/hotel/au/venus-surry-hills.html",
  },
  {
    id: "darling-harbour",
    name: "Darling Harbour",
    bookingUrl: "https://www.booking.com/hotel/au/chateau-de-venus.html",
  },
];

/** Ratings are on Booking.com's 10-point scale. Negative is below, positive is at or above. */
export const thresholds = Object.freeze({ negative: 6, positive: 8 });
export const timezone = "Australia/Sydney";
export const topics = Object.freeze([
  "cleanliness",
  "check_in",
  "staff",
  "noise",
  "facilities",
  "location",
  "room_condition",
  "value_for_money",
  "other",
]);

/** Plain-language names shown to operations staff. */
export const topicLabels = Object.freeze({
  cleanliness: "Cleanliness",
  check_in: "Check-in",
  staff: "Staff and reception",
  noise: "Noise",
  facilities: "Facilities",
  location: "Location",
  room_condition: "Room condition",
  value_for_money: "Value for money",
  other: "Other",
});

/** Fewer reviews than this in a period is flagged as low volume. */
export const lowVolume = 5;

/**
 * A property whose newest review is older than this is flagged, both on the
 * collection run and on the Data health tab. Each property normally gets new
 * Booking.com reviews every few days.
 */
export const staleAfterDays = 21;

/** Number of weeks shown in trend charts and sparklines. */
export const trendWeeks = 12;

/** Needs-attention rules. Each flag shows its reason and counts. */
export const attentionRules = Object.freeze({
  propertyDrop: { points: 0.5, minReviews: lowVolume },
  topicRise: { percentagePoints: 10, minComplaints: 3 },
  negativeBurst: { days: 7, count: 3 },
  severeIssue: { days: 7, severity: 3 },
});
