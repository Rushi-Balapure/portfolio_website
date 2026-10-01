export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

export function project(initialVelocity: number, decelerationRate = 0.998) {
  return (initialVelocity / 1000) * decelerationRate / (1 - decelerationRate);
}

interface SpringOptions {
  damping: number;
  response: number;
}

interface SpringState {
  position: number;
  velocity: number;
}

export function createSpring({ damping, response }: SpringOptions) {
  const omega = (2 * Math.PI) / response;

  return {
    step(position: number, velocity: number, target: number, dt: number): SpringState {
      const offset = position - target;
      const acceleration = -2 * damping * omega * velocity - omega * omega * offset;
      const nextVelocity = velocity + acceleration * dt;
      return {
        position: position + nextVelocity * dt,
        velocity: nextVelocity,
      };
    },
    settled(position: number, velocity: number, target: number) {
      return Math.abs(position - target) < 0.5 && Math.abs(velocity) < 12;
    },
  };
}
