// Date format conversion at the api boundary.
//
// DB stores dates as YYYY-MM-DD with `00` segments for unknown month/day
// (e.g. `1990-05-00` = May 1990, `1990-00-00` = year 1990, `0000-00-00` = undated).
// This is a legacy storage convention that lets us keep MySQL DATE columns and
// their date functions (`MAX`, `YEAR(...)`, etc.) while still recording partial
// precision.
//
// On the wire the api speaks ISO partial format: `YYYY` | `YYYY-MM` |
// `YYYY-MM-DD`. Trim trailing `-00` segments on read; pad them back on write.
// `0000-00-00` (undated) trims to `0000` — clients detect "undated" by year=0,
// same as before.

const DB_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_PATTERN = /^\d{4}(-\d{2}(-\d{2})?)?$/;

export const dbDateToIso = (db: string): string => {
	const match = DB_DATE_PATTERN.exec(db);
	if (!match) return db;
	const [, year, month, day] = match;
	if (month === '00') return year;
	if (day === '00') return `${year}-${month}`;
	return db;
};

export const isoDateToDb = (iso: string): string => {
	if (!ISO_DATE_PATTERN.test(iso)) {
		throw new Error(`Invalid ISO date: ${iso}`);
	}
	const parts = iso.split('-');
	while (parts.length < 3) {
		parts.push('00');
	}
	return parts.join('-');
};

// Validates ISO partial format. For full dates, also verifies day-in-month
// correctness (rejects `1990-02-31`). Year 0 is allowed for the "undated"
// sentinel that callers never write but may need to round-trip.
export const isValidIsoDate = (value: string): boolean => {
	if (!ISO_DATE_PATTERN.test(value)) return false;
	const parts = value.split('-');
	const year = Number(parts[0]);
	if (!Number.isInteger(year) || year < 0 || year > 9999) return false;
	if (parts.length === 1) return true;
	const month = Number(parts[1]);
	if (month < 1 || month > 12) return false;
	if (parts.length === 2) return true;
	const day = Number(parts[2]);
	if (day < 1 || day > 31) return false;
	const dt = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
	return dt.getUTCMonth() + 1 === month && dt.getUTCDate() === day;
};
