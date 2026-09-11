const CONFIG = {
  boardLengths: [3000, 4000, 6000],
  defaultBoardModule: 150,

  joist: {
    size: "40×40×2",
    stepByBoardHeight: {
      thinMaxHeight: 23,
      thinStep: 300,
      thickMinHeight: 24,
      thickStep: 400
    },
    seamOverhang: 125,
    maxEdgeCantilever: 200
  },

  belt: {
    size: "80×80×2",
    maxSpacing: 1500
  },

  metal: {
    stockLength: 6000
  },

  ground: {
    pileLength: 2500,
    porchPileLength: 2000,
    pileSpacingMax: 1500,
    houseOffset: 400
  },

  overhang: {
    min: 100,
    max: 150
  }
};