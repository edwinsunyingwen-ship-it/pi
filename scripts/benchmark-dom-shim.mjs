class BenchmarkDomMatrix {
	constructor(values = undefined) {
		this.values = values;
	}
}

class BenchmarkImageData {
	constructor(data = undefined, width = 0, height = 0) {
		this.data = data;
		this.width = width;
		this.height = height;
	}
}

class BenchmarkPath2D {}

globalThis.DOMMatrix ??= BenchmarkDomMatrix;
globalThis.ImageData ??= BenchmarkImageData;
globalThis.Path2D ??= BenchmarkPath2D;
