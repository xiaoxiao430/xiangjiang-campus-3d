import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveTrackDimensions, stadiumPoints } from '../src/track-geometry.js';

const config = JSON.parse(readFileSync(new URL('../public/campus.json', import.meta.url)));

test('first-lane measurement curve has a 250 metre perimeter', () => {
  const track = deriveTrackDimensions(config.sports.track);
  const points = stadiumPoints(track.radius + track.measurementOffset, track.straightLength, 2048);
  let length = 0;
  points.forEach((point, i) => {
    const next = points[(i + 1) % points.length];
    length += Math.hypot(next[0] - point[0], next[1] - point[1]);
  });
  assert.ok(Math.abs(length - 250) < 0.0001, `sampled length=${length}`);
});

test('a contradictory track radius and straight length is rejected', () => {
  assert.throws(() => deriveTrackDimensions({ ...config.sports.track, straight_length: 55 }), /不符/);
});

test('the outer running surface reaches the campus edge and buildings stay clear', () => {
  const t = deriveTrackDimensions(config.sports.track);
  const [x, z] = config.sports.track.position;
  const right = x + t.outerRadius;
  const clearance = (config.style.base_center?.[0] || 0) + config.style.base_size[0] / 2 - right;
  assert.ok(clearance > 0 && clearance <= 2.5, `right edge clearance=${clearance}`);
  const baseZ=config.style.base_center?.[1] || 0;
  assert.ok(z-t.outerLength/2 > baseZ-config.style.base_size[1]/2);
  assert.ok(z+t.outerLength/2 < baseZ+config.style.base_size[1]/2);
  for (const building of config.buildings) {
    const [bx, bz] = building.position;
    const [width, depth] = building.size;
    const overlap = bx + width / 2 > x - t.outerRadius
      && bx - width / 2 < right && bz + depth / 2 > z - t.outerLength / 2
      && bz - depth / 2 < z + t.outerLength / 2;
    assert.equal(overlap, false, `${building.id} must stay outside running area`);
  }
});

test('school corrections are kept in the public scene data', () => {
  const left = config.buildings.find(b => b.id === 'left-side');
  assert.equal(left.floors, 6);
  assert.equal(left.floor_usage['1'], '食堂');
  assert.equal(left.floor_usage['2'], '食堂');
  for(const floor of ['3','4','5','6'])assert.equal(left.floor_usage[floor],'住宿');
  assert.equal(config.buildings.find(b => b.id === 'central-tower').roof, 'pointed-pitched');
});

test('grandstand faces the track from the teaching-building side without entering a lane', () => {
  const stand = config.sports.grandstand;
  const t = deriveTrackDimensions(config.sports.track);
  assert.equal(stand.name,'主席台');
  assert.equal(stand.facing,'track');
  const right = stand.position[0]+stand.size[0]/2;
  assert.ok(right < config.sports.track.position[0]-t.outerRadius);
  assert.ok(Math.abs(stand.position[1])+stand.size[1]/2 < t.straightLength/2);
});

test('public data contains no local source paths or credentials', () => {
  const text = JSON.stringify(config);
  assert.equal(/\/Users\/|\/private\/|password|api[_-]?key|token|original_local_path/i.test(text), false);
  assert.equal('font' in config, false);
  assert.equal('source' in config, false);
});

test('four teaching blocks keep the confirmed floor counts and open ground floor', () => {
  const classrooms=config.buildings.filter(b=>b.kind==='classroom');
  assert.equal(classrooms.length,4);
  for(const id of ['left-front','right-front']) {
    const b=classrooms.find(b=>b.id===id);
    assert.equal(b.floors,5);assert.equal(b.ground_floor_open.enabled,true);
  }
  for(const id of ['left-rear','right-rear'])assert.equal(classrooms.find(b=>b.id===id).floors,7);
});

test('dining and residence stands by the left front court and left road', () => {
  const b=config.buildings.find(b=>b.id==='left-side');
  const front=config.buildings.find(b=>b.id==='left-front');
  const court=config.sports.basketball;
  const road=config.roads.left;
  const courtGap=court.position[0]-court.size[0]/2-(b.position[0]+b.size[0]/2);
  const roadGap=b.position[0]-b.size[0]/2-(road.position[0]+road.size[0]/2);
  assert.ok(courtGap>=0 && courtGap<=4);
  assert.ok(roadGap>=0 && roadGap<=7);
  assert.ok(b.position[1]+b.size[1]/2 < front.position[1]-front.size[1]/2);
});

test('rear amenities sit behind the seven-storey blocks, leaving the middle court open', () => {
  for(const [id,amenity] of [['left-rear',config.landscape.garden],['right-rear',config.sports.basketball_rear]]) {
    const b=config.buildings.find(b=>b.id===id);
    assert.ok(amenity.position[1]-amenity.size[1]/2 > b.position[1]+b.size[1]/2);
  }
  const garden=config.landscape.garden,g=garden.gazebo;
  assert.ok(Math.abs(g.position[0]-garden.position[0])+g.radius<garden.size[0]/2);
  assert.ok(Math.abs(g.position[1]-garden.position[1])+g.radius<garden.size[1]/2);
});

test('both sides have open walkways on floors two through five', () => {
  assert.equal(config.open_walkways.length,2);
  for(const corridor of config.open_walkways) {
    assert.deepEqual(corridor.floors,[2,3,4,5]);
    assert.ok(corridor.railing_height>0);
    assert.ok(corridor.deck_thickness<0.3);
    assert.ok(Math.abs(corridor.position[0])<15,'walkways must connect on the inner side');
  }
});

test('the rear court is half-sized and all four roads enclose the entire track', () => {
  assert.equal(config.sports.basketball_rear.mode,'half');
  assert.ok(config.sports.basketball_rear.size[0]<=17);
  const roads=config.roads;
  for(const side of ['left','right','front','rear'])assert.ok(roads[side]);
  const inner={left:roads.left.position[0]+roads.left.size[0]/2,
    right:roads.right.position[0]-roads.right.size[0]/2,
    front:roads.front.position[1]+roads.front.size[1]/2,
    rear:roads.rear.position[1]-roads.rear.size[1]/2};
  const t=deriveTrackDimensions(config.sports.track),[x,z]=config.sports.track.position;
  assert.ok(x-t.outerRadius>inner.left && x+t.outerRadius<inner.right);
  assert.ok(z-t.outerLength/2>inner.front && z+t.outerLength/2<inner.rear);
});

test('the widened oval preserves the 250 metre lap', () => {
  const t=deriveTrackDimensions(config.sports.track);
  assert.ok(t.outerWidth>=50);
  assert.ok(Math.abs(t.measuredLap-250)<1e-8);
});

test('four portrait front courts replace the former two landscape courts', () => {
  assert.equal(config.sports.front_courts.length,4);
  for(const court of config.sports.front_courts){assert.equal(court.orientation,'y');assert.ok(court.size[1]>court.size[0]);}
});

test('photo-guided landscaping stays clear of building footprints', () => {
  assert.ok(config.trees.length>=60);
  assert.ok(config.landscape.plantings.length>=10);
  for(const [x,y] of config.trees)for(const b of config.buildings){
    const [bx,by]=b.position,[w,d]=b.size;
    assert.equal(x>bx-w/2-.3&&x<bx+w/2+.3&&y>by-d/2-.3&&y<by+d/2+.3,false);
  }
});
