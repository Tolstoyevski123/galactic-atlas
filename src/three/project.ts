import { Matrix4, type Camera } from 'three'

const matrix = new Matrix4()

/**
 * Projects scene points to CSS pixels on the canvas. Call update() once per frame, then
 * project() as often as needed; the result is left in `x`, `y` (pixels) and `w` (view depth).
 */
export class ScreenProjector {
  x = 0
  y = 0
  w = 0
  private readonly e = matrix.elements.slice()
  private width = 1
  private height = 1

  update(camera: Camera, width: number, height: number): void {
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    for (let i = 0; i < 16; i++) this.e[i] = matrix.elements[i]
    this.width = width
    this.height = height
  }

  /** Returns false when the point is behind the camera. */
  project(px: number, py: number, pz: number): boolean {
    const e = this.e
    const w = e[3] * px + e[7] * py + e[11] * pz + e[15]
    if (w <= 1e-6) return false
    this.w = w
    this.x = ((e[0] * px + e[4] * py + e[8] * pz + e[12]) / w * 0.5 + 0.5) * this.width
    this.y = (0.5 - ((e[1] * px + e[5] * py + e[9] * pz + e[13]) / w) * 0.5) * this.height
    return true
  }
}
