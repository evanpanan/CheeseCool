export type LabelBox = { left: number; top: number; right: number; bottom: number };

// A label needs to check only the cells it touches, even on a large canvas.
export class LabelGrid {
  private cells = new Map<string, LabelBox[]>();
  constructor(private cellSize: number) {}

  clear() { this.cells.clear(); }

  reserve(box: LabelBox, required = false): boolean {
    const left = Math.floor(box.left / this.cellSize), right = Math.floor(box.right / this.cellSize);
    const top = Math.floor(box.top / this.cellSize), bottom = Math.floor(box.bottom / this.cellSize);

    if (!required) {
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const entries = this.cells.get(x + ':' + y);
          if (entries?.some(other => box.left < other.right && box.right > other.left &&
            box.top < other.bottom && box.bottom > other.top)) return false;
        }
      }
    }
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const key = x + ':' + y;
        const entries = this.cells.get(key);
        if (entries) entries.push(box);
        else this.cells.set(key, [box]);
      }
    }
    return true;
  }
}
