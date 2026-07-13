import {
  EllipsoidTerrainProvider,
  Ion,
  OpenStreetMapImageryProvider,
  Viewer,
  createOsmBuildingsAsync,
  createWorldTerrainAsync,
} from "cesium";

const OSM_CREDIT = "© OpenStreetMap contributors";

export async function createWorld(container, onStatus = () => {}) {
  const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim();
  const capabilities = {
    terrain: false,
    buildings: false,
  };

  if (ionToken) {
    Ion.defaultAccessToken = ionToken;
  }

  let terrainProvider = new EllipsoidTerrainProvider();

  if (ionToken) {
    try {
      onStatus("実在地形を読み込んでいます…");
      terrainProvider = await createWorldTerrainAsync({
        requestVertexNormals: true,
        requestWaterMask: true,
      });
      capabilities.terrain = true;
    } catch (error) {
      console.warn("Cesium World Terrain could not be loaded.", error);
      onStatus("地形の読込みに失敗したため、標高なし地形で続行します");
    }
  }

  const viewer = new Viewer(container, {
    terrainProvider,
    baseLayer: false,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    shouldAnimate: true,
  });

  viewer.imageryLayers.addImageryProvider(
    new OpenStreetMapImageryProvider({
      url: "https://tile.openstreetmap.org/",
      maximumLevel: 19,
      credit: OSM_CREDIT,
    }),
  );

  viewer.scene.globe.depthTestAgainstTerrain = capabilities.terrain;
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.highDynamicRange = true;
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1.5;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 30_000_000;

  if (ionToken) {
    try {
      onStatus("実在建物を読み込んでいます…");
      const buildings = await createOsmBuildingsAsync();
      viewer.scene.primitives.add(buildings);
      capabilities.buildings = true;
    } catch (error) {
      console.warn("Cesium OSM Buildings could not be loaded.", error);
      onStatus("建物データなしで続行します");
    }
  }

  return { viewer, capabilities };
}
