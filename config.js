const CONFIG = {
  boardLengths: [3000, 4000, 6000],

  // Временно задаётся вручную в интерфейсе.
  // Позже рабочая ширина будет приходить из номенклатуры конкретной доски.
  defaultBoardModule: 150,

  joist: {
    size: "40×40×2",
    minStep: 300,
    maxStep: 400,
    defaultStep: 350,
    seamOverhang: 125
  },

  belt: {
    size: "80×80×2",
    // Временный параметр до утверждения точного правила расчёта пояса.
    defaultStep: 1500
  },

  overhang: {
    min: 100,
    max: 150
  },

  ground: {
    pileLength: 2500,
    porchPileLength: 2000,
    pileSpacingMin: 1000,
    pileSpacingMax: 2000,
    preferredPileSpacing: 1500,
    minEdge: 400
  }
};