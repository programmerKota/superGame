import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const CESIUM_SOURCE = "node_modules/cesium/Build/Cesium";
const CESIUM_OUTPUT_DIRECTORY = "cesiumStatic";

export default defineConfig({
  base: "./",
  define: {
    CESIUM_BASE_URL: JSON.stringify(`./${CESIUM_OUTPUT_DIRECTORY}/`),
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: `${CESIUM_SOURCE}/ThirdParty`,
          dest: CESIUM_OUTPUT_DIRECTORY,
        },
        {
          src: `${CESIUM_SOURCE}/Workers`,
          dest: CESIUM_OUTPUT_DIRECTORY,
        },
        {
          src: `${CESIUM_SOURCE}/Assets`,
          dest: CESIUM_OUTPUT_DIRECTORY,
        },
        {
          src: `${CESIUM_SOURCE}/Widgets`,
          dest: CESIUM_OUTPUT_DIRECTORY,
        },
      ],
    }),
  ],
});
