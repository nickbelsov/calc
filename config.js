const CONFIG = {
  algorithmVersion: "2.0",
  boardLengths: [3000, 4000, 6000],
  defaultBoardModule: 150,
  boardGap: 3,

  joist: {
    size: "40×40×2",
    stepByBoardHeight: {
      thinMaxHeight: 23,
      thinStep: 300,
      thickMinHeight: 24,
      thickStep: 400
    },
    seamOverhang: 100,
    maxEdgeCantilever: 40
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
    min: 0,
    max: 100
  },

  concreteSupportSpecs: {
    rebar: { diameterMm: 10, heightMm: 100 },
    rubber: { widthMm: 100, depthMm: 100, thicknessMm: 5 },
    plastic: { type: "adjustable-screw" }
  },

  engineering: {
    designLiveLoadKgM2: 500,
    deckingDeadLoadKgM2: 25,
    deckingDeadLoadFactor: 1.10,
    gravity: 9.81,
    elasticModulusMPa: 200000,
    steelRyMPa: 230,
    deflectionRatio: 200,
    terracePointLoadKN: 1.0,
    terracePointLoadFactor: 1.2,
    sections: {
      joist40x40x2: {
        I_mm4: 70700,
        W_mm3: 3530,
        massKgM: 2.33,
        source: "GOST 8639"
      },
      belt80x80x2: {
        I_mm4: 633152,
        W_mm3: 15828.8,
        massKgM: 4.90,
        source: "geometric"
      }
    }
  },

  rules: {
    boardStockIsDiscrete: true,
    boardStockCannotBeRejoined: true,
    boardOffcutsCanBeReusedAsWholePieces: true,
    metalCanBeCutAndWelded: true,
    metalPurchaseMultiple: 6000,
    preferredLayout: "half",
    boardGapAlwaysMm: 3,
    boardCantileverOnJoistMaxMm: 40,
    houseSidePileOffset: 400,
    freeEdgeSupportCantileverMax: 200,
    concreteSupportMaxSpacingMm: 500,
    roofSupportMaxSpacingMm: 750,
    concreteTieStepMaxMm: 1500,
    concreteUsesBelt80x80: false,
    concreteSupportsFollowJoists: true,
    roofSupportsFollowJoists: true
  }
  ,pricing: {
    source: "МойСклад · выгрузка 13.09.2026 · Цена РРЦ",
    board: {
      double: {3000:1350, 4000:1800, 6000:2700},
      elite: {3000:1590, 4000:2120, 6000:3180}
    },
    profile40x40x2_per_m: 224,
    profile80x80x2_per_m: 470,
    pileD76_2500_with_head: 2990
  }
};