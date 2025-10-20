import Vue from "vue";
import Vuex from "vuex";

import { ascending, rollup, max } from "d3-array";
import { json } from "d3-fetch";
import { queryFeatureServer } from "@/utils";

Vue.use(Vuex);

// These neighborhoods can be ignored
const missingHoods = ["Park", "Airport-Navy Yard", "NE Airport"];

/**
 * Get neighborhood sizes
 */
function getNeighborhoodSizes(tractFeatures) {
  return rollup(
    tractFeatures,
    (grp) => max(grp, (d) => +d.properties.tract_id),
    (d) => d.properties.neighborhood_name
  );
}

/**
 * Get unique neighborhood names, sorted alphabetically
 */
function getNeighborhoodNames(tractFeatures) {
  // Extract neighborhood names
  let values = tractFeatures.map((d) => d.properties.neighborhood_name);

  // Return unique values, sorted
  return [...new Set(values)]
    .filter((name) => !missingHoods.includes(name))
    .sort((a, b) => ascending(a, b));
}

/**
 * Region (PUMA) names, sorted alphabetically
 */
function getRegionNames(tractFeatures) {
  // Extract PUMA names
  let values = tractFeatures.map((d) => d.properties.puma_name);

  // Return unique values, sorted
  return [...new Set(values)].sort((a, b) => ascending(a, b));
}

// URL for geojson
const ARCGIS_URL =
  "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services";

// Config for downloading geojson
const geojsonSourceConfig = [
  {
    name: "tracts",
    url: `${ARCGIS_URL}/SPI_Dashboard_Census_Tracts/FeatureServer/0`,
    outFields: [
      "geoid",
      "neighborhood_name",
      "puma_name",
      "tract_id",
      "missing",
    ],
  },
  {
    name: "cityLimits",
    url: `${ARCGIS_URL}/SPI_Dashboard_City_Limits/FeatureServer/0`,
  },
  {
    name: "hoods",
    url: `${ARCGIS_URL}/SPI_Dashboard_Neighborhoods/FeatureServer/0`,
    outFields: ["neighborhood_name"],
  },
  {
    name: "pumas",
    url: `${ARCGIS_URL}/SPI_Dashboard_PUMAs/FeatureServer/0`,
    outFields: ["puma_name"],
  },
];

// s3 URL
const VERSION = "3";
const BRANCH = "main";
const REPO =
  "https://raw.githubusercontent.com/PhillyController/progressphl-data";
const DATA_URL = `${REPO}/${BRANCH}/data-products/dashboard-inputs/v${VERSION}`;

export default new Vuex.Store({
  state: {
    /**
     * The height of the ProgressPHL navbar in pixels
     */
    navBarHeight: 52,

    /**
     * The height of the controller.phila.gov navbar in pixels
     */
    controllerNavHeight: null,

    /**
     * Do we need top padding
     */
    usePadding: null,

    /**
     * Main, tract-level SPI data
     */
    data: null,

    /**
     * SPI metadata dict
     */
    metadata: null,

    /**
     * Dict of geojson sources
     */
    geojson: null,

    /**
     * Unique neighborhood names
     */
    neighborhoodNames: null,

    /**
     * Neighborhood sizes
     */
    neighborhoodSizes: null,

    /**
     * Unique region names
     */
    regionNames: null,

    /**
     * Dimension names
     */
    dimensionNames: [
      "basic_human_needs",
      "foundations_of_wellbeing",
      "opportunity",
    ],

    /**
     * Tract names for scorecards
     */
    scorecardTractNames: [],

    // Map from regions to neighborhoods and vice versa
    regionsToHoods: require("@/data/regionsToHoods"),
    hoodsToRegions: require("@/data/hoodsToRegions"),

    // Data caches
    indicatorsDataCache: {},
    trendsDataCache: {},
  },
  actions: {
    /**
     * Fetch SPI data
     */
    fetchSPIData(store) {
      return json(`${DATA_URL}/spi-data.json`).then((data) => {
        store.commit("setValue", { value: data, key: "data" });
        return data;
      });
    },

    /**
     * Fetch SPI metadata
     */
    fetchSPIMetadata(store) {
      return json(`${DATA_URL}/spi-metadata.json`).then((data) => {
        store.commit("setValue", { value: data, key: "metadata" });
        return data;
      });
    },

    /**
     * Fetch all the geojson features
     */
    fetchGeojson(store) {
      // Get the geojson query promises
      let queries = [];
      for (let i = 0; i < geojsonSourceConfig.length; i++) {
        let config = geojsonSourceConfig[i];
        let promise = queryFeatureServer({
          url: config.url,
          outFields: config.outFields,
        });
        queries.push(promise);
      }

      // Get names
      const geojsonSourceNames = geojsonSourceConfig.map((d) => d.name);

      // Save when all are resolved
      return Promise.allSettled(queries).then((results) => {
        // Loop over the results and store them
        let geojson = {};
        results.forEach((result, i) => {
          // Store the geojson
          let name = geojsonSourceNames[i];
          geojson[name] = result.value;

          // if tracts, store extra info
          if (name === "tracts") {
            // Neighborhood names
            store.commit("setValue", {
              value: getNeighborhoodNames(geojson[name].features),
              key: "neighborhoodNames",
            });

            // Neighborhood sizes
            store.commit("setValue", {
              value: getNeighborhoodSizes(geojson[name].features),
              key: "neighborhoodSizes",
            });

            // Region names
            store.commit("setValue", {
              value: getRegionNames(geojson[name].features),
              key: "regionNames",
            });
          }
        });

        // Save it
        store.commit("setValue", { value: geojson, key: "geojson" });
        return geojson;
      });
    },

    /**
     * Fetch indicators data
     */
    fetchIndicatorsData(store, { name }) {
      const url = `${DATA_URL}/census-data/${name}.json`;
      return json(url).then((data) => {
        store.commit("setValue", {
          value: data,
          key: `indicatorsDataCache.${name}`,
        });
        return data;
      });
    },

    /**
     * Fetch trends data
     */
    fetchTrendsData(store, { variable }) {
      const url = `${DATA_URL}/trends/${variable}.json`;
      return json(url).then((data) => {
        store.commit("setValue", {
          value: data,
          key: `trendsDataCache.${variable}`,
        });
        return data;
      });
    },
  },
  mutations: {
    setValue(state, { key, value }) {
      if (key.includes(".")) {
        let keys = key.split(".");
        state[keys[0]][keys[1]] = value;
      } else {
        state[key] = value;
      }
    },
  },
});
