<template>
  <div class="tw-relative tw-h-full tw-w-full">
    <!-- Overlay -->
    <loading-overlay v-if="!loaded" />

    <!-- Address seach bar -->
    <div
      class="tw-absolute tw-left-0 tw-top-0 tw-z-[8] tw-w-full tw-rounded tw-bg-transparent tw-px-4 tw-py-2"
    >
      <geography-search-bar
        class="tw-text-xl"
        placeholder="Search"
        :value="selectedGeographyName"
        :always-placeholder="false"
        @input="$emit('geography:select', $event)"
      />
    </div>

    <!-- Map div -->
    <div id="explorer-map"></div>

    <!-- Mapped variable seach bar -->
    <div
      class="tw-absolute tw-left-0 tw-bottom-0 tw-z-[8] tw-w-full tw-rounded tw-bg-transparent tw-px-4 tw-py-2"
    >
      <social-progress-dropdown
        class="tw-text-base"
        :value="displayedVariable"
        label="Map variable"
        @input="$emit('update:map-variable', $event)"
      />
    </div>
  </div>
</template>

<script>
// local
import GeographySearchBar from "./components/GeographySearchBar";
import LoadingOverlay from "@/components/Loading/LoadingOverlay";
import SocialProgressDropdown from "./components/SocialProgressDropdown";

// geospatial
import maplibregl from "maplibre-gl";
import bbox from "@turf/bbox";

// d3
import { scaleDiverging } from "d3-scale";
import { interpolateRdYlGn } from "d3-scale-chromatic";
import { group } from "d3-array";
import { format } from "d3-format";
import { mapState } from "vuex";

export default {
  name: "ExplorerMap",
  props: {
    /**
     * Name of the variable displayed on the map
     */
    displayedVariable: { type: String, required: true },

    /**
     * Name of selected geography
     */
    selectedGeographyName: { type: String },

    /**
     * Type of selected geography
     */
    selectedGeographyType: { type: String },

    /**
     * Array of geoids for focused tracts
     */
    focusedIds: { type: Array },
  },
  components: { LoadingOverlay, GeographySearchBar, SocialProgressDropdown },
  data() {
    return {
      /**
       * Is the map fully loaded?
       * */
      loaded: false,

      /**
       * The hovered and clicked IDs
       */
      hoveredId: null,
      clickedId: null,

      /**
       * The bounds for all of Philadelphia
       */
      homeBounds: null,

      /**
       * Options for the maplibre map
       */
      mapOptions: {
        maxZoom: 18,
        minZoom: 10,
        zoom: 10,
        center: [-75.12, 40.0],
        maxPitch: 0,
        pitchWithRotate: false,
        dragRotate: false,
        touchPitch: false,
        attributionControl: false,
        maxBounds: [
          -75.47684326171915, 39.80088227118165, -74.82315673828148,
          40.19853877259828,
        ],
      },
    };
  },
  created() {
    // Store map as a non-reactive variable
    this.map = null;
  },

  /**
   * Initialize the map when the component is mounted
   */
  mounted() {
    this.initializeMap();
  },
  computed: {
    // Get the state from
    ...mapState([
      "data",
      "metadata",
      "geojson",
      "dimensionNames",
      "neighborhoodNames",
      "regionNames",
    ]),

    /**
     * The map's diverging color scale
     */
    colorScale() {
      let domain =
        this.displayedVariable == "social_progress_index" ||
        this.dimensionNames.includes(this.displayedVariable)
          ? [20, 50, 80]
          : [0, 50, 100];
      return scaleDiverging()
        .domain(domain)
        .range([0, 0.5, 1.0])
        .interpolator(interpolateRdYlGn);
    },

    /**
     * Alias for displayed name
     */
    displayedVariableName() {
      return this.metadata.aliases[this.displayedVariable];
    },

    /**
     * List of variable names, including dimensions and components
     */
    variableNames() {
      //  Output list of names
      let out = ["social_progress_index"];

      // Loop over 3 dimensions
      for (let i = 0; i < this.dimensionNames.length; i++) {
        let dimension = this.dimensionNames[i];
        out.push(dimension);

        // Loop over the components
        for (let j = 0; j < this.metadata.hierarchy[dimension].length; j++) {
          let component = this.metadata.hierarchy[dimension][j];
          out.push(component);
        }
      }
      return out;
    },

    /**
     * Aliased (display) variable names
     */
    displayVariableNames() {
      return this.variableNames.map((d) => this.metadata.aliases[d]);
    },

    /**
     * Map from tract GEOID to data being shown on the map;
     * Allows for fast color setting in the map
     */
    selectedMapData() {
      // Defensive: avoid calling d3.group on undefined
      if (!this.data || !this.metadata || !Array.isArray(this.variableNames)) {
        return new Map();
      }

      let i = this.displayVariableNames.indexOf(this.displayedVariableName);
      if (i < 0) return new Map();

      let key = this.variableNames[i];
      const arr = key && Array.isArray(this.data[key]) ? this.data[key] : [];
      return group(arr, (d) => d.geoid);
    },
  },

  watch: {
    /**
     * If the selected geography changes, draw the layer
     */
    selectedGeographyName() {
      this.drawSelectedGeographyLayer();
    },

    displayedVariable() {
      this.updateColorValues();
    },

    /**
     * Handle initial map set up
     */
    loaded(value) {
      // Map is loaded and we have a selected geography
      if (value && this.selectedGeographyName != null) {
        this.drawSelectedGeographyLayer();
      }
    },
  },

  methods: {
    setFocusedFeatureState() {
      let data = this.geojson.tracts;

      // Update the "focus" feature state
      for (let i = 0; i < data.features.length; i++) {
        // This feature
        let feature = data.features[i];
        let id = feature.properties.geoid;

        // Is this tract focused?
        let focused = this.focusedIds.includes(id);

        // Set the state
        this.map.setFeatureState(
          { source: "census-tracts-source", id: id },
          { focus: focused }
        );
      }
    },

    /***
     * Initialize the map
     */
    initializeMap() {
      // Get the map container
      let mapContainer = document.getElementById("explorer-map");

      //  Initialize it
      if (mapContainer != null) {
        // Create the map
        let map = new maplibregl.Map({
          container: mapContainer,
          style: require("@/data/style-light.json"),
          ...this.mapOptions,
        });

        // When map is loaded, initialize it
        map.on("load", async () => {
          // map.addControl(
          //   new maplibregl.AttributionControl({
          //     compact: true,
          //     customAttribution: "Esri, FAO, NOAA, USGS; Powered by Esri",
          //   }),
          //   "bottom-right"
          // );

          // Add layers
          this.addLayers(map);

          // Add tooltip
          this.addTooltip(map);

          // Update choropleth colors
          this.updateColorValues();

          // Show census tracts
          map.setLayoutProperty("tract-fills", "visibility", "visible");
          map.setLayoutProperty("tract-outlines", "visibility", "visible");

          // Save home bounds
          this.homeBounds = map.getBounds();

          // Loaded
          this.loaded = true;
          this.$emit("loaded");
        });

        // Handle hover tracking
        map.on("mousemove", "tract-fills", this.setHoverState);
        map.on("mouseleave", "tract-fills", this.resetHoverState);

        // Handle map clicks
        map.on("click", "tract-fills", this.handleMapClick);

        // Save the map
        this.map = map;
      }
    },

    /*-------------------------------------
      Reset the hovered feature state
    /* -----------------------------------*/
    resetHoverState() {
      // Reset existing hovered tract
      if (this.hoveredId !== null) {
        // Emit
        this.$emit("geography:unhover");

        this.map.setFeatureState(
          { source: "census-tracts-source", id: this.hoveredId },
          { hover: false }
        );
      }

      // Nothing hovered right now
      this.hoveredId = null;
    },

    /*-------------------------------------
      Set the hovered feature state
    /* -----------------------------------*/
    setHoverState(e) {
      if (e.features.length > 0) {
        // The feature
        let tract = e.features[0];

        // Reset existing hovered tract
        if (this.hoveredId !== null) {
          this.map.setFeatureState(
            { source: "census-tracts-source", id: this.hoveredId },
            { hover: false }
          );
        }

        // If tract is missing, do nothing
        if (tract.properties.missing > 0) {
          this.$emit("geography:unhover");
          return;
        }

        // Emit the hover event
        this.$emit("geography:hover", tract.id);

        // Update hover state
        this.hoveredId = tract.id;
        this.map.setFeatureState(
          { source: "census-tracts-source", id: tract.id },
          { hover: true }
        );
      }
    },

    /**
     * Handle the click event by emitting the selected tract
     */
    handleMapClick(e) {
      if (e.features.length > 0) {
        // The clicked feature
        let tract = e.features[0];

        // Not focused, then return
        if (
          tract.properties.missing > 0
          //|| tract.state.focus == false
        ) {
          return;
        }

        // Emit the selected tract
        let d = tract.properties;
        let name = `${d.neighborhood_name} ${d.tract_id}`;
        this.$emit("geography:select", { type: "tract", name: name });
      }
    },

    /**
     * Add layers and sources to the map
     */
    addLayers(map) {
      /**
       * Step 1: Add the city limits
       */
      map.addSource("city-limits-source", {
        type: "geojson",
        data: this.geojson.cityLimits,
      });
      map.addLayer({
        id: "city-limits",
        source: "city-limits-source",
        type: "line",
        paint: {
          "line-color": "black",
          "line-width": 2,
        },
      });

      /**
       * Step 2: Add the census tracts
       */

      // 2A. The source
      map.addSource("census-tracts-source", {
        type: "geojson",
        data: this.geojson.tracts,
        promoteId: "geoid",
      });

      // 2B. Tract fills layer
      map.addLayer(
        {
          id: "tract-fills",
          source: "census-tracts-source",
          type: "fill",
          layout: { visibility: "none" },
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "focus"], true],
              0.7,
              0.25,
            ],
          },
        },
        "Road/label/Local"
      );

      // 2C. Tract outlines layer
      map.addLayer(
        {
          id: "tract-outlines",
          source: "census-tracts-source",
          type: "line",
          layout: { visibility: "none" },
          paint: {
            "line-width": [
              "case",
              ["boolean", ["feature-state", "click"], false],
              1,
              ["boolean", ["feature-state", "hover"], false],
              1,
              0,
            ],
            "line-color": "#27272a",
          },
        },
        "Road/label/Local"
      );
    },
    highlightGeographyLayer({ name, type }) {
      return this.drawLayer({
        layerName: "highlighted-geography-outlines",
        name,
        type,
        weight: 2,
        zoom: false,
        focus: false,
      });
    },

    unHighlightGeographyLayer() {
      // Remove existing
      const layerName = "highlighted-geography-outlines";
      if (this.map.getLayer(layerName)) this.map.removeLayer(layerName);
      if (this.map.getSource(layerName)) this.map.removeSource(layerName);
    },

    drawLayer({ layerName, name, type, weight, zoom, focus }) {
      // Remove existing
      if (this.map.getLayer(layerName)) this.map.removeLayer(layerName);
      if (this.map.getSource(layerName)) this.map.removeSource(layerName);

      // Get the feature
      let feature;
      if (type == "neighborhood")
        feature = this.geojson.hoods.features.find(
          (d) => d.properties.neighborhood_name === name
        );
      else if (type == "region") {
        feature = this.geojson.pumas.features.find(
          (d) => d.properties.puma_name === name
        );
      } else if (type == "tract") {
        feature = this.geojson.tracts.features.find(
          (d) =>
            `${d.properties.neighborhood_name} ${d.properties.tract_id}` == name
        );
      }

      // Update the focused state
      if (focus) this.setFocusedFeatureState();

      // If selected neighborhood is null, we're done
      if (!feature) {
        if (zoom) this.map.fitBounds(this.homeBounds);
        return;
      }

      // Add
      this.map.addLayer({
        id: layerName,
        type: "line",
        source: {
          type: "geojson",
          data: feature,
        },
        paint: {
          "line-width": weight,
          "line-color": "#000",
        },
      });

      // Zoom to the feature!
      if (zoom) {
        let thisBbox = bbox({
          type: "FeatureCollection",
          features: [feature],
        });

        // Determine padding
        let padding = { top: 75, left: 25, right: 25, bottom: 125 };

        // Zoom
        this.map.fitBounds(thisBbox, {
          padding: padding,
        });
      }
    },

    drawSelectedGeographyLayer() {
      return this.drawLayer({
        layerName: "selected-geography-outlines",
        name: this.selectedGeographyName,
        type: this.selectedGeographyType,
        weight: 5,
        zoom: true,
        focus: true,
      });
    },

    /**
     * Add tooltip to the map
     */
    addTooltip(map) {
      // Add tooltip
      let popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 20,
      });

      // Add the popup
      map.on("mousemove", "tract-fills", (e) => {
        if (e.features.length > 0) {
          let tract = e.features[0];

          // If missing, do nothing
          if (tract.properties.missing > 0) {
            popup.remove();
            return;
          }

          // Add popup
          popup
            .setLngLat(e.lngLat)
            .setHTML(this.getTooltipHTML(tract.properties))
            .addTo(map);
        }
      });

      // Remove the popup
      map.on("mouseleave", "tract-fills", () => {
        popup.remove();
      });
    },

    /**
     * Get the tooltip HTML content
     */
    getTooltipHTML(d) {
      let v;
      if (d.value == null) v = "No data";
      else v = format(".1f")(d.value);

      return `<div class="tw-rounded tw-p-0.5 tw-text-center">
    <div
      class="tw-flex tw-w-full tw-flex-col tw-items-center tw-border-b-[1px] tw-border-stone-200 tw-pb-0.5"
    >
      <div class="tw-text-base">${d.neighborhood_name} ${d.tract_id}</div>
    </div>
    <div class="tw-mx-auto tw-text-center tw-text-2xl tw-font-semibold">
      ${v}
    </div>
  </div>`;
    },

    /**
     * Based on selected map data update "color" and "value" columns
     */
    updateColorValues() {
      // Source data for census tracts
      let data = Object.assign({}, this.geojson.tracts);

      // Loop over each source feature
      for (let i = 0; i < data.features.length; i++) {
        // The feature
        let feature = data.features[i];

        // The value of the geoid column
        let id = feature.properties.geoid;

        // Get the value and color
        let match = this.selectedMapData.get(`${id}`);

        // If no match, we don't have data for this tract
        if (!match) {
          feature.properties["color"] = "#d4d4d4";
          feature.properties["value"] = null;

          // Get the color and value from the data
        } else {
          let value = match[0].value || 0;
          let color = this.colorScale(value);

          // Update the data
          feature.properties["color"] = color;
          feature.properties["value"] = value;
        }
      }

      // Update the map's data source
      this.map.getSource("census-tracts-source").setData(data);
    },
  },
};
</script>

<style>
.mapboxgl-ctrl-attrib-button,
.maplibregl-ctrl-attrib-inner,
.maplibregl-ctrl-attrib {
  background-color: #d6d3d1 !important;
}

.maplibregl-popup {
  z-index: 8 !important;
  width: 150px !important;
}

#explorer-map {
  width: 100%;
  height: 100%;
}
</style>
