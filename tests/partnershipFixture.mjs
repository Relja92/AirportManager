import {GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
export function setupPartnership(game) {
  game.silent=true;game.newGame('LHR');const s=game.state;
  s.money=50e6;s.rep=65;s.minute=0;s.day=0;s.rng=54321;s.events=[];s.eventsUntil=1e9;
  s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);s.tut=null;s.contracts=[];
  s.hubs[0].levels={runway:4,terminal:4,gates:4,amenities:1,cargo:1,fuel:1,marketing:1};
  const rv=s.rivals[0];Object.assign(rv,{name:'Meridian Air',generation:'test-meridian',hub:'CDG',hubs:[{id:'CDG',level:4,specialization:'transfer'}],cash:20e6,rep:65,
    routes:['JFK','BOS','DXB'].map(dest=>({hub:'CDG',dest,type:'heron',price:1,service:'frequent',cabin:0,age:0,lossDays:0})),next:1e6,nextHub:1e6});
  s.rivals=[rv];
  for(const dest of ['CDG','MAD']) {const r=game.addRoute('LHR',dest);r.service='frequent';game.assign(game.createPlane('kestrel',false,'LHR').id,r.id,true);}
  game._rev++;
  return {s,rv,r:s.routes[0],p:s.planes[0]};
}
