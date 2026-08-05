// Pick the geographically nearest available country to a desired one — used to
// choose the closest proxy egress country when the exact one is unavailable.
//
// combined-data.json maps ISO country code -> { latitude_precise,
// longitude_precise }. See data/combined-data.json (a stub; TODO expand to a
// full country-centroid dataset).

const geolib = require("geolib");
const combinedData = require("../../../data/combined-data.json");

const geo = {
	findNearestCountry: (givenCountry, availableCountries) => {
		// Some provider country lists include codes that aren't real ISO
		// countries (e.g. "eu"), so they have no coordinates. Skip anything the
		// dataset doesn't know to avoid reading lat/long off undefined.
		const knownCountries = availableCountries.filter((country) => {
			return combinedData[country];
		});

		if (!combinedData[givenCountry] || knownCountries.length === 0) {
			return knownCountries[0] || givenCountry;
		}

		const otherPoints = knownCountries.map((country) => {
			return {
				latitude: combinedData[country].latitude_precise,
				longitude: combinedData[country].longitude_precise
			};
		});

		const givenPoint = {
			latitude: combinedData[givenCountry].latitude_precise,
			longitude: combinedData[givenCountry].longitude_precise
		};

		const nearestPoint = geolib.findNearest(givenPoint, otherPoints);

		const nearestCountry = Object.entries(combinedData).find((country) => {
			return country[1].latitude_precise === nearestPoint.latitude &&
				country[1].longitude_precise === nearestPoint.longitude;
		});

		return nearestCountry[0];
	}
};

module.exports = geo;
