/** A 250 m track is measured 0.30 m outside its inner curb in lane one. */
export function deriveTrackDimensions(track = {}) {
  const radius = Number(track.radius ?? 16);
  const lapLength = Number(track.lap_length ?? 250);
  const measurementOffset = Number(track.measurement_offset ?? 0.3);
  const laneCount = Number(track.lane_count ?? 4);
  const laneWidth = Number(track.lane_width ?? 1.1);
  const straightLength = Number(track.straight_length
    ?? (lapLength - 2 * Math.PI * (radius + measurementOffset)) / 2);
  if (![radius, lapLength, laneWidth, straightLength].every(v => Number.isFinite(v) && v > 0)
      || !Number.isFinite(measurementOffset) || measurementOffset < 0
      || !Number.isInteger(laneCount) || laneCount < 1 || laneCount > 10) {
    throw new Error('跑道尺寸不完整，请检查半径、直道与道宽。');
  }
  const measuredLap = 2 * straightLength + 2 * Math.PI * (radius + measurementOffset);
  if (Math.abs(measuredLap - lapLength) > 0.05) {
    throw new Error(`跑道测量线长 ${measuredLap.toFixed(2)} 米，与 ${lapLength} 米设置不符。`);
  }
  const outerRadius = radius + laneCount * laneWidth;
  return {
    radius, lapLength, measuredLap, measurementOffset, laneCount, laneWidth,
    straightLength, outerRadius, outerWidth: 2 * outerRadius,
    outerLength: straightLength + 2 * outerRadius,
  };
}

/** Counter-clockwise capsule outline in the campus x/z plane. */
export function stadiumPoints(radius, straightLength, segments = 64) {
  const points = [[radius, -straightLength / 2], [radius, straightLength / 2]];
  for (let i = 1; i <= segments; i += 1) {
    const a = i * Math.PI / segments;
    points.push([Math.cos(a) * radius, straightLength / 2 + Math.sin(a) * radius]);
  }
  points.push([-radius, -straightLength / 2]);
  for (let i = 1; i <= segments; i += 1) {
    const a = Math.PI + i * Math.PI / segments;
    points.push([Math.cos(a) * radius, -straightLength / 2 + Math.sin(a) * radius]);
  }
  return points;
}
