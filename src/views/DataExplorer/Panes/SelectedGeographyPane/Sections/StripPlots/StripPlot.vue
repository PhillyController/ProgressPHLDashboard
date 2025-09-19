<template>
  <div v-if="data" :id="id" class="tw-text-base"></div>
</template>

<script>
// d3
import { scaleLinear, scaleDiverging } from "d3-scale";
import { select } from "d3-selection";
import { interpolateRdYlGn } from "d3-scale-chromatic";
import { format } from "d3-format";

// Ensure circles go in same place
const seedrandom = require("seedrandom");

export default {
  name: "StripPlot",
  props: {
    /**
     * Data being shown
     */
    data: {
      type: Array,
      required: false,
      default: () => [],
    },

    /**
     * Array of focused ids
     */
    focusedIds: {
      type: Array,
      default: () => [],
    },

    hoveredId: {
      type: String,
      default: null,
    },

    /**
     * Width of the chart
     */
    maxWidth: {
      type: Number,
      default: 1000,
    },

    /**
     * Height of the chart
     */
    height: {
      type: Number,
      default: 80,
    },

    /**
     * Id for the chart
     */
    id: {
      type: String,
      default: () => `strip_plot_${Math.random().toString(12).substring(2, 8)}`,
    },

    /**
     * Add the axis labels?
     */
    addAxisLabels: { type: Boolean, default: false },
  },

  data() {
    return {
      svg: null,
      parentWidth: null,
      observer: null,

      /**
       * Circle size
       */
      circleSize: 6,

      /**
       * Focused opacity
       */
      focusedOpacity: 0.7,

      /**
       * Selected (only one at a time) opacity
       */
      selectedOpacity: 1.0,

      /**
       * Hover opacity
       */
      hoverOpacity: 0.7,
    };
  },

  computed: {
    /**
     * Hidden opacity
     */
    hiddenOpacity() {
      return this.$mq === "mobile" ? 0.1 : 0.1;
    },
    /** Width of the chart */
    width() {
      if (this.parentWidth) return Math.min(this.parentWidth, this.maxWidth);
    },

    /**
     * Whether to show the label with values
     */
    showLabels() {
      return Array.isArray(this.focusedIds) && this.focusedIds.length === 1;
    },

    /**
     * Selected GEOID
     */
    selectedGeoid() {
      if (this.showLabels) return this.focusedIds[0];
    },

    /**
     * Y-coordinates for the points
     */
    yCoords() {
      let rng = seedrandom(1234);
      return this.data.map((d) => rng() * (0.75 - 0.25) + 0.25);
    },

    /**
     * The margin for the SVG
     */
    margin() {
      return { top: 10, right: 20, bottom: 25, left: 10 };
    },

    /**
     * Color scale for circles
     */
    colorScale() {
      return scaleDiverging()
        .domain([0, 50, 100])
        .range([0, 0.5, 1])
        .interpolator(interpolateRdYlGn);
    },

    /**
     * X-axis from 0 to 100
     */
    x() {
      return scaleLinear()
        .domain([0, 100])
        .range([0, this.width - this.margin.right - this.margin.left]);
    },

    /**
     * Y-axis from 0 to 1
     */
    y() {
      return scaleLinear()
        .domain([0, 1.0])
        .range([this.height - this.margin.bottom - this.margin.top, 0]);
    },
  },

  methods: {
    /**
     * Remove selection labels
     */
    removeSelectionLabels() {
      select(this.$el).select("svg > g").selectAll(".selection-label").remove();
    },
    /**
     * Add value labels for selected circle
     */
    addSelectionLabels(geoid) {
      // Save the vue instance
      let t = this;
      let svg = select(t.$el).select("svg > g");

      // Loop over all circles
      svg.selectAll("circle").each(function (d, i) {
        // Get the circle selection
        let circle = select(this);

        // Add the labels
        if (d.geoid == geoid) {
          // Format function
          let f = format(".0f");

          // Add line
          svg
            .append("line")
            .attr("class", "selection-label")
            .attr("x1", t.x(d.value))
            .attr("x2", t.x(d.value))
            .attr("y1", circle.attr("cy"))
            .attr("y2", t.y(0))
            .attr("stroke", "#262626")
            .attr("stroke-width", "2px");

          // Add label
          svg
            .append("text")
            .attr("class", "selection-label")
            .attr("x", t.x(d.value))
            .attr("y", t.y(0))
            .attr("dx", 0)
            .attr("dy", "1em")
            .style("font-size", "1em")
            .style("fill", "#1f2937")
            .attr("text-anchor", "middle")
            .text(f(d.value));

          // Bring the circle to the front
          circle.style("fill-opacity", t.selectedOpacity).raise();
        }
      });
    },

    /**
     * Set the default style for the input selection
     */
    setDefaultStyle(circles) {
      return circles
        .style("fill", (d) => this.colorScale(d.value))
        .style("stroke", "#262626")
        .style("stroke-width", 0)
        .style("stroke-opacity", 0.8);
    },

    /**
     * Set the style for when circles are hovered over
     */
    setHoverStyle(circles) {
      return circles
        .style("stroke-width", 2.0)
        .style("stroke-opacity", 1.0)
        .style("fill-opacity", (d) =>
          d.geoid === this.selectedGeoid
            ? this.selectedOpacity
            : this.hoverOpacity
        )
        .raise();
    },

    /**
     * Set the style for hidden circles
     */
    setHiddenStyle(circles) {
      return circles
        .style("fill-opacity", this.hiddenOpacity)
        .style("stroke-width", 0);
    },

    /**
     * Set the style for focused circles
     */
    setFocusedStyle(circles) {
      return circles
        .style("fill-opacity", (d) =>
          d.geoid === this.selectedGeoid
            ? this.selectedOpacity
            : this.focusedOpacity
        )
        .style("stroke-width", 1.5)
        .style("stroke-opacity", 1)
        .raise();
    },

    /**
     * Draw the chart
     */
    drawChart() {
      // Create svg if we need to
      let emit = false;
      if (!this.svg) {
        this.svg = select(this.$el)
          .append("svg")
          .attr("width", this.width)
          .attr("height", this.height);

        emit = true;
      }

      // Remove any existing
      this.svg.select(".padding-group").remove();

      // Size the svg
      const margin = this.margin;
      const height = this.height - margin.top - margin.bottom;
      const width = this.width - margin.left - margin.right;

      // Create the SVG group
      const svg = this.svg
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("class", "padding-group")
        .attr("transform", `translate(${this.margin.left},${this.margin.top})`);

      // Add axis lines
      svg
        .append("line")
        .attr("x1", () => this.x(0))
        .attr("x2", () => this.x(100))
        .attr("y1", this.y(0.5))
        .attr("y2", this.y(0.5))
        .attr("stroke", "#a1a1a1")
        .attr("stroke-width", "2px");

      // Add axis labels
      if (this.addAxisLabels) {
        svg
          .selectAll("tick")
          .data([0, 50, 100])
          .join("line")
          .attr("x1", (d) => this.x(d))
          .attr("x2", (d) => this.x(d))
          .attr("y1", this.y(0.8))
          .attr("y2", this.y(0.5))
          .attr("stroke", "#a1a1a1")
          .attr("stroke-width", "2px");
        svg
          .selectAll("ticklabel")
          .data([0, 50, 100])
          .join("text")
          .attr("x", (d) => this.x(d))
          .attr("y", this.y(0.8))
          .attr("dx", 0)
          .attr("dy", -5)
          .style("font-size", "0.85em")
          .style("fill", "#525252")
          .attr("text-anchor", "middle")
          .text((d) => d);
      }

      // Add circles with default style
      let t = this;
      let circles = svg
        .selectAll("circle")
        .data(this.data)
        .join("circle")
        .attr("cx", (d) => this.x(d.value))
        .attr("cy", (d, i) => this.y(this.yCoords[i]))
        .attr("r", t.circleSize)
        .call(t.setDefaultStyle);

      // Hide some circles
      circles
        .filter((d) => !t.focusedIds.includes(d.geoid))
        .call(t.setHiddenStyle);

      // Focus the rest
      circles
        .filter((d) => t.focusedIds.includes(d.geoid))
        .raise()
        .call(t.setFocusedStyle);

      // Add interactions
      circles
        .on("click", function (event, d) {
          // Prevent default behavor
          event.preventDefault();
          event.stopPropagation();

          // Emit the clicked tract name
          let name = `${d.neighborhood_name} ${+d.tract_id}`;
          t.$emit("click", { name, type: "tract" });
        })
        .on("mouseover", function (event, d) {
          // Style
          select(this).raise().call(t.setHoverStyle);

          // Emit
          let name = `${d.neighborhood_name} ${+d.tract_id}`;
          t.$emit("mouseover", { name, type: "tract" });
        })
        .on("mouseleave", function (event, d) {
          // Emit
          t.$emit("mouseleave");

          // Style
          let circle = select(this);
          if (t.focusedIds.includes(d.geoid)) {
            circle.call(t.setFocusedStyle);
          } else circle.call(t.setHiddenStyle);
        });

      if (emit) this.$emit("ready");
    },
  },

  mounted() {
    const observer = new ResizeObserver(() => {
      const el = $(this.$el.parentElement);
      this.parentWidth = el.width();
    });
    observer.observe(this.$el.parentElement);
    this.observer = observer;
  },

  watch: {
    width() {
      // Initialize the chart
      this.drawChart();

      // Add value labels?
      if (this.showLabels) this.addSelectionLabels(this.selectedGeoid);
    },

    /**
     * When the hovered id changes, update style
     */
    hoveredId(newValue, oldValue) {
      // Save the vue component
      let t = this;

      // Remove any old selection labels
      this.removeSelectionLabels();

      // Do we need to show labels
      if (this.showLabels && newValue === null)
        this.addSelectionLabels(this.selectedGeoid);

      // Iterate over circles
      let hoveredCircle;
      select(this.$el)
        .select("svg")
        .selectAll("circle")
        .each(function (d, i) {
          // Get the circle selection
          let circle = select(this);

          // Style a hovered circle
          if (newValue !== null) {
            // Hide all
            circle.call(t.setHiddenStyle);

            // Handle new hover
            if (d.geoid === newValue) {
              hoveredCircle = circle;
              circle.call(t.setHoverStyle);
            }
          }
          // Restore: No more hovered circle
          else {
            if (t.focusedIds.includes(d.geoid)) circle.call(t.setFocusedStyle);
            else circle.call(t.setHiddenStyle);
          }
        });

      // Raise the hovered circle
      if (hoveredCircle) {
        hoveredCircle.raise();
        this.addSelectionLabels(newValue);
      }
    },

    /**
     * Update styles when focused ids change
     */
    focusedIds(newValue) {
      // Save the vue instance
      let t = this;

      // Get the circles and style them
      select(this.$el)
        .select("svg")
        .selectAll("circle")
        .each(function (d, i) {
          // Get the circle selection
          let circle = select(this);

          // Reset back to default
          if (newValue.includes(d.geoid)) {
            circle.call(t.setFocusedStyle);
          } else {
            circle.call(t.setHiddenStyle);
          }
        });
    },

    /**
     * If the selected geoid changes, add new labels
     */
    selectedGeoid(newValue, oldValue) {
      if (newValue !== oldValue) {
        // Remove existing
        this.removeSelectionLabels();

        // Add new ones
        if (newValue) this.addSelectionLabels(newValue);
      }
    },
  },
};
</script>

<style>
circle {
  cursor: pointer;
}
</style>
