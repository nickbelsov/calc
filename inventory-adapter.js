(function(){
  const mockProducts=[
    {
      id:"test-wpc-wenge",
      name:"ДПК NIMTECH · Венге · тест",
      variants:{
        3000:{stock:64,sku:"TEST-WPC-WENGE-3000"},
        4000:{stock:38,sku:"TEST-WPC-WENGE-4000"},
        6000:{stock:12,sku:"TEST-WPC-WENGE-6000"}
      }
    },
    {
      id:"test-wpc-graphite",
      name:"ДПК NIMTECH · Графит · тест",
      variants:{
        3000:{stock:0,sku:"TEST-WPC-GRAPHITE-3000"},
        4000:{stock:27,sku:"TEST-WPC-GRAPHITE-4000"},
        6000:{stock:8,sku:"TEST-WPC-GRAPHITE-6000"}
      }
    }
  ];

  window.NIMTECH_INVENTORY={
    mode:"mock",
    products:mockProducts,
    getProduct(id){return this.products.find(p=>p.id===id)||this.products[0]||null;},
    async refresh(){
      // Production path:
      // const res=await fetch("/api/inventory");
      // this.products=await res.json();
      // this.mode="live";
      // No MoySklad token is ever stored in frontend code.
      return this.products;
    }
  };
})();