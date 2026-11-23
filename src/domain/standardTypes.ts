import type { AircraftCategory } from "./constants";

/**
 * Starter list of common business-aircraft types, with their usual size category.
 * It is a convenience list, not authority: categories differ between sources, every entry can be
 * recategorised, and the owner's own types are never overwritten when the list is loaded.
 */
export interface StandardType {
  manufacturer: string;
  model: string;
  category: AircraftCategory;
  aliases?: string[];
}

const t = (manufacturer: string, category: AircraftCategory, models: (string | [string, string[]])[]): StandardType[] =>
  models.map((m) => (Array.isArray(m) ? { manufacturer, model: m[0], category, aliases: m[1] } : { manufacturer, model: m, category }));

export const STANDARD_AIRCRAFT_TYPES: StandardType[] = [
  // Very light
  ...t("Cessna", "very_light_jet", ["Citation Mustang"]),
  ...t("Embraer", "very_light_jet", ["Phenom 100", "Phenom 100E", "Phenom 100EV"]),
  ...t("Eclipse", "very_light_jet", ["500", "550"]),
  ...t("Cirrus", "very_light_jet", [["Vision Jet SF50", ["SF50", "Vision Jet"]]]),
  ...t("Honda", "very_light_jet", [["HondaJet HA-420", ["HondaJet", "HondaJet Elite"]]]),

  // Light
  ...t("Embraer", "light_jet", ["Phenom 300", "Phenom 300E"]),
  ...t("Cessna", "light_jet", ["Citation M2", "Citation CJ1", "Citation CJ2", "Citation CJ3", "Citation CJ3 Plus", "Citation CJ4", "Citation Bravo"]),
  ...t("Bombardier", "light_jet", ["Learjet 40", "Learjet 45", "Learjet 70", "Learjet 75"]),
  ...t("Pilatus", "light_jet", ["PC-24"]),
  ...t("Beechcraft", "light_jet", [["Premier IA", ["Premier 1A"]]]),
  ...t("Hawker", "light_jet", ["400XP"]),
  ...t("Gulfstream", "light_jet", ["G100"]),

  // Midsize
  ...t("Cessna", "midsize_jet", ["Citation Excel", "Citation XLS", "Citation XLS Plus", "Citation Latitude", "Citation Ascend"]),
  ...t("Bombardier", "midsize_jet", ["Learjet 60", "Learjet 60XR"]),
  ...t("Hawker", "midsize_jet", ["750", "800XP", "850XP", "900XP"]),
  ...t("Gulfstream", "midsize_jet", ["G150"]),
  ...t("Embraer", "midsize_jet", ["Praetor 500", "Legacy 450"]),

  // Super midsize
  ...t("Bombardier", "super_midsize_jet", [["Challenger 300", ["CL300"]], ["Challenger 350", ["CL350"]], ["Challenger 3500", ["CL3500"]]]),
  ...t("Cessna", "super_midsize_jet", ["Citation Sovereign", "Citation Sovereign Plus", "Citation X", "Citation X Plus", "Citation Longitude"]),
  ...t("Gulfstream", "super_midsize_jet", ["G200", "G280"]),
  ...t("Dassault", "super_midsize_jet", ["Falcon 2000", "Falcon 2000EX", "Falcon 2000LX", "Falcon 2000S", "Falcon 2000LXS"]),
  ...t("Embraer", "super_midsize_jet", ["Praetor 600", "Legacy 500"]),
  ...t("Hawker", "super_midsize_jet", ["4000"]),

  // Heavy (large)
  ...t("Bombardier", "heavy_jet", [["Challenger 604", ["CL604"]], ["Challenger 605", ["CL605"]], ["Challenger 650", ["CL650"]], "Global 5000", "Global 5500", "Global Express"]),
  ...t("Gulfstream", "heavy_jet", ["G350", "G400", "G450", "GIV", "GIV-SP"]),
  ...t("Dassault", "heavy_jet", ["Falcon 900", "Falcon 900EX", "Falcon 900LX", "Falcon 900DX"]),
  ...t("Embraer", "heavy_jet", ["Legacy 600", "Legacy 650", "Legacy 650E"]),

  // Ultra long range
  ...t("Gulfstream", "ultra_long_range_jet", ["GV", "G500", "G550", "G600", [("G650"), ["G VI"]], ["G650ER", ["G650 ER"]], "G700", "G800"]),
  ...t("Bombardier", "ultra_long_range_jet", ["Global 6000", "Global 6500", "Global 7500", "Global 8000", "Global Express XRS"]),
  ...t("Dassault", "ultra_long_range_jet", ["Falcon 6X", "Falcon 7X", "Falcon 8X", "Falcon 10X"]),

  // Executive airliners
  ...t("Boeing", "executive_airliner", [["BBJ", ["Boeing Business Jet", "BBJ 737"]], "BBJ MAX 8", "BBJ MAX 9", "BBJ 787-8", "747-8 VIP"]),
  ...t("Airbus", "executive_airliner", [["ACJ319neo", ["ACJ319"]], ["ACJ320neo", ["ACJ320"]], "ACJ321neo", "ACJ330neo", ["ACJ350 XWB", ["ACJ350"]]]),
  ...t("Embraer", "executive_airliner", [["Lineage 1000", ["Lineage 1000E"]]]),

  // Turboprops
  ...t("Beechcraft", "turboprop", ["King Air 250", ["King Air 350i", ["King Air 350"]]]),
  ...t("Pilatus", "turboprop", [["PC-12 NGX", ["PC-12", "PC-12 NG"]]]),
  ...t("Daher", "turboprop", ["TBM 900", "TBM 940", "TBM 960"]),
  ...t("Cessna", "turboprop", ["Grand Caravan EX"]),

  // Helicopters
  ...t("Airbus", "helicopter", ["H125", "H130", "H135", "H145", "H155", "H160", "H175", "AS350 B3", "EC135", "EC145"]),
  ...t("Leonardo", "helicopter", ["AW109 Grand", "AW109 Trekker", "AW119", "AW139", "AW169", "AW189"]),
  ...t("Sikorsky", "helicopter", ["S-76C++", "S-76D", "S-92"]),
  ...t("Bell", "helicopter", ["407", "412", "429", "505", "525 Relentless"]),
  ...t("Robinson", "helicopter", ["R44", "R66"]),

  // ---- Older and additional types commonly seen in charter and the second-hand market ----
  ...t("Cessna", "very_light_jet", ["Citation CJ1 Plus", "Citation Jet"]),
  ...t("Cessna", "light_jet", ["Citation CJ2 Plus", "Citation Ultra", "Citation V", "Citation II", "Citation I"]),
  ...t("Cessna", "midsize_jet", ["Citation Encore", "Citation Encore Plus", "Citation VII"]),
  ...t("Cessna", "super_midsize_jet", ["Citation Hemisphere"]),
  ...t("Bombardier", "light_jet", ["Learjet 31A", "Learjet 35A", "Learjet 36A"]),
  ...t("Bombardier", "midsize_jet", ["Learjet 55", "Learjet 60 SE"]),
  ...t("Bombardier", "heavy_jet", ["Challenger 601", "Challenger 850"]),
  ...t("Hawker", "midsize_jet", ["125-700", "800A", "800", "1000"]),
  ...t("Beechcraft", "light_jet", ["Beechjet 400A", "Beechjet 400"]),
  ...t("Dassault", "midsize_jet", ["Falcon 20", "Falcon 50", "Falcon 50EX"]),
  ...t("Dassault", "heavy_jet", ["Falcon 900B", "Falcon 900C", "Falcon 900EX EASy", "Falcon 2000EX EASy"]),
  ...t("Gulfstream", "heavy_jet", ["GIII", "G300", "GIV-X"]),
  ...t("Gulfstream", "ultra_long_range_jet", ["GV-SP"]),
  ...t("Boeing", "executive_airliner", ["BBJ2", "BBJ3", "777-300ER VIP", "787-9 VIP", "767-300 VIP", "757-200 VIP", "737-700 VIP", "727-100 VIP"]),
  ...t("Airbus", "executive_airliner", ["ACJ318", "ACJ340", "A380 VIP"]),
  ...t("Bombardier", "executive_airliner", ["CRJ-200 VIP", "CRJ-700 VIP"]),
  ...t("Beechcraft", "turboprop", ["King Air 90", "King Air 200", "King Air 260", "King Air 360"]),
  ...t("Piaggio", "turboprop", ["Avanti EVO"]),
  ...t("Cessna", "turboprop", ["Caravan 208B"]),
  ...t("Pilatus", "turboprop", ["PC-6 Porter"]),

  // ---- More helicopters, as operators name them (older Eurocopter names kept as their own types) ----
  ...t("Airbus", "helicopter", [
    ["EC130 T2", ["EC-130 T2", "EC130T2", "EC130"]],
    ["EC130 B4", ["EC-130 B4", "EC130B4"]],
    ["EC135 P2+", ["EC-135 P2+", "EC135 P2", "EC135P2+"]],
    ["EC135 T2+", ["EC-135 T2+", "EC135 T2"]],
    ["EC145 T2", ["EC-145 T2"]],
    ["EC155 B1", ["EC-155", "EC155"]],
    ["EC175", ["EC-175"]],
    ["EC225", ["EC-225", "H225 Super Puma"]],
    "H120", "H140", "H215", "H225",
    ["AS350 B2", ["AS350", "Ecureuil"]],
    ["AS355 NP", ["AS355", "TwinStar", "Twin Squirrel"]],
    ["AS365 N3", ["AS365", "Dauphin"]],
    ["AS332 L2", ["AS332", "Super Puma"]],
    ["BK117 C-2", ["BK117"]],
  ]),
  ...t("Leonardo", "helicopter", [["AW109 SP", ["AW109SP", "GrandNew", "AW109 GrandNew"]], ["AW109 Power", ["A109E", "A109 Power"]], "AW009", "AW149", "AW609"]),
  ...t("Bell", "helicopter", [["206B JetRanger", ["JetRanger", "206B"]], ["206L LongRanger", ["206L", "LongRanger"]], "222", "230", "427", "430", "429 GlobalRanger", "212", "214", "505 Jet Ranger X"]),
  ...t("Sikorsky", "helicopter", ["S-76A", "S-76B", "S-61", "S-70"]),
  ...t("MD Helicopters", "helicopter", ["MD 500E", "MD 530F", "MD 600N", ["MD 902 Explorer", ["MD 902", "MD Explorer"]]]),
  ...t("Robinson", "helicopter", ["R22", "R44 Raven II", "R66 Turbine"]),
  ...t("Enstrom", "helicopter", ["480B"]),
  ...t("Kazan", "helicopter", ["Ansat"]),
  ...t("Bell", "helicopter", ["407GX", "407GXi"]),

  // ---- More types seen in operator fleets ----
  ...t("Beechcraft", "turboprop", [["1900D", ["Beech 1900D", "1900"]], ["King Air B200", ["B200", "King Air B200GT"]]]),
  ...t("Bombardier", "light_jet", [["Learjet 45XR", ["LJ45XR"]]]),
  ...t("Nextant", "light_jet", ["400XT", "400XTi"]),
  ...t("Cessna", "light_jet", [["Citation CJ4 Gen2", ["CJ4 Gen 2", "Citation CJ4 Gen 2"]]]),
];

/** Bump when the list grows so the app loads the new entries once (existing entries are never changed). */
export const STANDARD_LIST_VERSION = "standard-v4";
