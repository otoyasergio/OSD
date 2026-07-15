"use server";

import {
  getFitmentPartsWithCatalog,
  listFitmentMakes,
  listFitmentModels,
  listFitmentYears,
} from "@/lib/services/fitment";

export async function loadFitmentYearsAction(): Promise<number[]> {
  return listFitmentYears();
}

export async function loadFitmentMakesAction(year: number): Promise<string[]> {
  return listFitmentMakes(year);
}

export async function loadFitmentModelsAction(
  year: number,
  make: string
): Promise<string[]> {
  return listFitmentModels(year, make);
}

export async function loadFitmentPartsAction(
  year: number,
  make: string,
  model: string
) {
  const result = await getFitmentPartsWithCatalog(year, make, model);
  if (!result) return null;
  return { specs: result.specs, parts: result.parts };
}
