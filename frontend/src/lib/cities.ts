export interface SheetCity {
  country: string;
  city: string;
  underboss: string;
  region: string;
  chatUrl: string;
  groupId: string;
}

const SHEET_ID = '16T3_iXywToXQqxTyDIniWIA4SUI8Wj0a5LKHSAJL_9Q';
const GID = '811297100';

export async function fetchSheetCities(): Promise<SheetCity[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${GID}&headers=11`;
  const response = await fetch(url);
  const text = await response.text();
  // Strip JSONP wrapper: google.visualization.Query.setResponse({...})
  const json = JSON.parse(text.replace(/^[^(]*\(/, '').replace(/\);?$/, ''));

  return json.table.rows
    .map((row: any) => ({
      country: row.c?.[4]?.v || '',
      city: row.c?.[5]?.v || '',
      underboss: row.c?.[6]?.v || '',
      region: row.c?.[7]?.v || '',
      chatUrl: row.c?.[8]?.v || '',
      groupId: String(row.c?.[10]?.v || '').replace('#', '').trim(),
    }))
    .filter((g: SheetCity) => g.city); // Include ALL rows with a city name
}
