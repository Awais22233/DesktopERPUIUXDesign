import { describe, expect, it } from "vitest"
import { formatRupees, lineAmount, parseRupees, weightedAverage } from "../src/core/money"

describe("money", () => {
  it("parses and formats rupees without floating point", () => {
    expect(parseRupees("1,500")).toBe(150_000)
    expect(parseRupees("0.1") + parseRupees("0.2")).toBe(30)
    expect(parseRupees("1500.5")).toBe(150_050)
    expect(formatRupees(150_050)).toBe("1,500.50")
    expect(formatRupees(10_000_000)).toBe("100,000")
    expect(formatRupees(-250)).toBe("-2.50")
  })
  it("rejects invalid input", () => {
    expect(() => parseRupees("abc")).toThrow()
    expect(() => parseRupees("1.234")).toThrow()
  })
  it("multiplies by whole quantities only", () => {
    expect(lineAmount(150_000, 5)).toBe(750_000)
    expect(() => lineAmount(100, 1.5)).toThrow()
  })
  it("weighted average", () => {
    expect(weightedAverage(10, 100_000, 10, 120_000)).toBe(110_000)
    expect(weightedAverage(0, 0, 5, 90_000)).toBe(90_000)
    expect(weightedAverage(3, 100, 1, 101)).toBe(100) // rounds to nearest paisa
  })
})
