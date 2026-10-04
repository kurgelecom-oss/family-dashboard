// Static-page adapter for app/lib/ecom/{shopify-fees,bundles}.ts.
// tests/offer-model.test.mjs checks parity with those canonical calculations.
// Each cost is the supplier's TOTAL for that pack, including delivery.
export const TIERS = [
  {key:'excellent',label:'Excellent',before:.65},
  {key:'good',label:'Good',before:.55},
  {key:'average',label:'Average',before:.45},
  {key:'poor',label:'Poor',before:.35},
];
const RATES = {basic:[1.75,2.9,3.5],grow:[1.6,2.8,3.4],advanced:[1.4,2.7,3.3]};
export function calculateOffers({cost,cpa,plan='basic',retPct=8,retLossPct=25,extraPerOrder=0}) {
  const rates=RATES[plan]||RATES.basic;
  const feeRate=(rates[0]*.85+rates[1]*.05+rates[2]*.10)/100;
  const returnsRate=Math.max(0,Math.min(100,retPct))/100*Math.max(0,Math.min(100,retLossPct))/100;
  const fixed=Math.max(0,cost)+Math.max(0,extraPerOrder)+.30;
  const slope=target=>(1-returnsRate-target)/1.1-feeRate;
  const fundedSlope=slope(.20);
  const floor=fundedSlope>0?(fixed+Math.max(0,cpa))/fundedSlope:Infinity;
  return TIERS.map(tier=>{
    const price=slope(tier.before)>0?fixed/slope(tier.before):Infinity;
    if(!Number.isFinite(price))return {...tier,price,unreachable:true,floor,targetCpa:NaN,profit:NaN,margin:NaN,headroom:NaN,fundsCpa:false};
    const net=price/1.1, gst=price-net, fee=price*feeRate+.30, returns=net*returnsRate;
    const before=net-Math.max(0,cost)-Math.max(0,extraPerOrder)-fee-returns;
    const targetCpa=before-.20*net,profit=before-Math.max(0,cpa);
    return {...tier,price,net,gst,fee,returns,before,targetCpa,profit,margin:profit/net,
      floor,headroom:targetCpa-Math.max(0,cpa),fundsCpa:targetCpa>=cpa,unreachable:false};
  });
}
