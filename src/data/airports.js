import { characteristicsFor } from './markets.js';
// Real airports: [IATA, city, country, lat, lon, size 1..5]
// size is a rough traffic tier: 5 = global mega-hub, 1 = small national airport.
const RAW = [
  // Europe
  ['LHR', 'London', 'GB', 51.47, -0.4543, 5],
  ['CDG', 'Paris', 'FR', 49.0097, 2.5479, 5],
  ['FRA', 'Frankfurt', 'DE', 50.0379, 8.5622, 5],
  ['AMS', 'Amsterdam', 'NL', 52.3105, 4.7683, 5],
  ['IST', 'Istanbul', 'TR', 41.2753, 28.7519, 5],
  ['MAD', 'Madrid', 'ES', 40.4983, -3.5676, 4],
  ['BCN', 'Barcelona', 'ES', 41.2974, 2.0833, 4],
  ['FCO', 'Rome', 'IT', 41.8003, 12.2389, 4],
  ['MUC', 'Munich', 'DE', 48.3537, 11.775, 4],
  ['SVO', 'Moscow', 'RU', 55.9726, 37.4146, 4],
  ['ZRH', 'Zurich', 'CH', 47.4582, 8.5555, 3],
  ['VIE', 'Vienna', 'AT', 48.1103, 16.5697, 3],
  ['CPH', 'Copenhagen', 'DK', 55.618, 12.6508, 3],
  ['ARN', 'Stockholm', 'SE', 59.6498, 17.9238, 3],
  ['OSL', 'Oslo', 'NO', 60.1976, 11.1004, 3],
  ['HEL', 'Helsinki', 'FI', 60.3172, 24.9633, 3],
  ['DUB', 'Dublin', 'IE', 53.4264, -6.2499, 3],
  ['LIS', 'Lisbon', 'PT', 38.7742, -9.1342, 3],
  ['ATH', 'Athens', 'GR', 37.9364, 23.9445, 3],
  ['WAW', 'Warsaw', 'PL', 52.1657, 20.9671, 3],
  ['MAN', 'Manchester', 'GB', 53.3537, -2.275, 3],
  ['BRU', 'Brussels', 'BE', 50.9014, 4.4844, 3],
  ['MXP', 'Milan', 'IT', 45.6306, 8.7281, 3],
  ['PRG', 'Prague', 'CZ', 50.1008, 14.26, 2],
  ['BUD', 'Budapest', 'HU', 47.4369, 19.2556, 2],
  ['BEG', 'Belgrade', 'RS', 44.8184, 20.3091, 2],
  ['OTP', 'Bucharest', 'RO', 44.5711, 26.085, 2],
  ['EDI', 'Edinburgh', 'GB', 55.95, -3.3725, 2],
  ['LED', 'St Petersburg', 'RU', 59.8003, 30.2625, 2],
  ['KBP', 'Kyiv', 'UA', 50.345, 30.8947, 2],
  ['NCE', 'Nice', 'FR', 43.6584, 7.2159, 2],
  ['GVA', 'Geneva', 'CH', 46.2381, 6.109, 2],
  ['ZAG', 'Zagreb', 'HR', 45.7429, 16.0688, 1],
  ['SOF', 'Sofia', 'BG', 42.6952, 23.4062, 1],
  ['KEF', 'Reykjavik', 'IS', 63.985, -22.6056, 1],
  ['LJU', 'Ljubljana', 'SI', 46.2237, 14.4576, 1],
  ['SJJ', 'Sarajevo', 'BA', 43.8246, 18.3315, 1],
  ['TGD', 'Podgorica', 'ME', 42.3594, 19.2519, 1],
  ['SKP', 'Skopje', 'MK', 41.9616, 21.6214, 1],
  ['TIA', 'Tirana', 'AL', 41.4147, 19.7206, 1],

  // Middle East & Africa
  ['DXB', 'Dubai', 'AE', 25.2532, 55.3657, 5],
  ['DOH', 'Doha', 'QA', 25.2731, 51.6081, 4],
  ['JNB', 'Johannesburg', 'ZA', -26.1392, 28.246, 4],
  ['AUH', 'Abu Dhabi', 'AE', 24.433, 54.6511, 3],
  ['RUH', 'Riyadh', 'SA', 24.9576, 46.6988, 3],
  ['JED', 'Jeddah', 'SA', 21.6796, 39.1565, 3],
  ['TLV', 'Tel Aviv', 'IL', 32.0114, 34.8867, 3],
  ['CAI', 'Cairo', 'EG', 30.1219, 31.4056, 3],
  ['LOS', 'Lagos', 'NG', 6.5774, 3.3212, 3],
  ['ADD', 'Addis Ababa', 'ET', 8.9779, 38.7993, 3],
  ['NBO', 'Nairobi', 'KE', -1.3192, 36.9278, 3],
  ['CPT', 'Cape Town', 'ZA', -33.9648, 18.6017, 3],
  ['CMN', 'Casablanca', 'MA', 33.3675, -7.59, 2],
  ['ALG', 'Algiers', 'DZ', 36.691, 3.2154, 2],
  ['ACC', 'Accra', 'GH', 5.6052, -0.1668, 2],
  ['IKA', 'Tehran', 'IR', 35.4161, 51.1522, 2],
  ['TUN', 'Tunis', 'TN', 36.851, 10.2272, 1],
  ['DAR', 'Dar es Salaam', 'TZ', -6.8781, 39.2026, 1],
  ['DSS', 'Dakar', 'SN', 14.67, -17.0733, 1],
  ['LAD', 'Luanda', 'AO', -8.8584, 13.2312, 1],
  ['TNR', 'Antananarivo', 'MG', -18.7969, 47.4788, 1],
  ['MRU', 'Mauritius', 'MU', -20.4302, 57.6836, 1],

  // Asia
  ['DEL', 'Delhi', 'IN', 28.5562, 77.1, 5],
  ['BKK', 'Bangkok', 'TH', 13.69, 100.7501, 5],
  ['SIN', 'Singapore', 'SG', 1.3644, 103.9915, 5],
  ['HKG', 'Hong Kong', 'HK', 22.308, 113.9185, 5],
  ['PEK', 'Beijing', 'CN', 40.0799, 116.6031, 5],
  ['PVG', 'Shanghai', 'CN', 31.1443, 121.8083, 5],
  ['CAN', 'Guangzhou', 'CN', 23.3924, 113.2988, 5],
  ['ICN', 'Seoul', 'KR', 37.4602, 126.4407, 5],
  ['HND', 'Tokyo', 'JP', 35.5494, 139.7798, 5],
  ['BOM', 'Mumbai', 'IN', 19.0896, 72.8656, 4],
  ['KUL', 'Kuala Lumpur', 'MY', 2.7456, 101.7099, 4],
  ['CGK', 'Jakarta', 'ID', -6.1256, 106.6559, 4],
  ['MNL', 'Manila', 'PH', 14.5086, 121.0198, 4],
  ['CTU', 'Chengdu', 'CN', 30.5785, 103.9471, 4],
  ['TPE', 'Taipei', 'TW', 25.0797, 121.2342, 4],
  ['KIX', 'Osaka', 'JP', 34.432, 135.2304, 4],
  ['BLR', 'Bengaluru', 'IN', 13.1986, 77.7066, 3],
  ['MAA', 'Chennai', 'IN', 12.9941, 80.1709, 3],
  ['DPS', 'Bali', 'ID', -8.7482, 115.1672, 3],
  ['SGN', 'Ho Chi Minh City', 'VN', 10.8188, 106.652, 3],
  ['HAN', 'Hanoi', 'VN', 21.2212, 105.8072, 3],
  ['CCU', 'Kolkata', 'IN', 22.6547, 88.4467, 2],
  ['KHI', 'Karachi', 'PK', 24.9065, 67.1608, 2],
  ['ISB', 'Islamabad', 'PK', 33.5491, 72.8258, 2],
  ['DAC', 'Dhaka', 'BD', 23.8433, 90.3978, 2],
  ['CMB', 'Colombo', 'LK', 7.1808, 79.8841, 2],
  ['ALA', 'Almaty', 'KZ', 43.3521, 77.0405, 2],
  ['URC', 'Urumqi', 'CN', 43.9071, 87.4742, 2],
  ['CTS', 'Sapporo', 'JP', 42.7752, 141.6923, 2],
  ['OVB', 'Novosibirsk', 'RU', 55.0126, 82.6507, 2],
  ['KTM', 'Kathmandu', 'NP', 27.6966, 85.3591, 1],
  ['MLE', 'Malé', 'MV', 4.1918, 73.5291, 1],
  ['TAS', 'Tashkent', 'UZ', 41.2579, 69.2812, 1],
  ['UBN', 'Ulaanbaatar', 'MN', 47.6469, 106.8195, 1],
  ['VVO', 'Vladivostok', 'RU', 43.399, 132.148, 1],

  // Oceania & Pacific
  ['SYD', 'Sydney', 'AU', -33.9399, 151.1753, 4],
  ['MEL', 'Melbourne', 'AU', -37.669, 144.841, 4],
  ['BNE', 'Brisbane', 'AU', -27.3842, 153.1175, 3],
  ['PER', 'Perth', 'AU', -31.9385, 115.9672, 3],
  ['AKL', 'Auckland', 'NZ', -37.0082, 174.785, 3],
  ['HNL', 'Honolulu', 'US', 21.3187, -157.9225, 3],
  ['CHC', 'Christchurch', 'NZ', -43.4894, 172.532, 1],
  ['NAN', 'Nadi', 'FJ', -17.7554, 177.4431, 1],
  ['POM', 'Port Moresby', 'PG', -9.4434, 147.22, 1],
  ['PPT', 'Tahiti', 'PF', -17.5537, -149.607, 1],

  // North & Central America
  ['ATL', 'Atlanta', 'US', 33.6407, -84.4277, 5],
  ['JFK', 'New York', 'US', 40.6413, -73.7781, 5],
  ['LAX', 'Los Angeles', 'US', 33.9416, -118.4085, 5],
  ['ORD', 'Chicago', 'US', 41.9742, -87.9073, 5],
  ['DFW', 'Dallas', 'US', 32.8998, -97.0403, 5],
  ['DEN', 'Denver', 'US', 39.8561, -104.6737, 4],
  ['SFO', 'San Francisco', 'US', 37.6213, -122.379, 4],
  ['SEA', 'Seattle', 'US', 47.4502, -122.3088, 4],
  ['MIA', 'Miami', 'US', 25.7959, -80.287, 4],
  ['IAH', 'Houston', 'US', 29.9902, -95.3368, 4],
  ['YYZ', 'Toronto', 'CA', 43.6777, -79.6248, 4],
  ['MEX', 'Mexico City', 'MX', 19.4361, -99.0719, 4],
  ['BOS', 'Boston', 'US', 42.3656, -71.0096, 3],
  ['IAD', 'Washington', 'US', 38.9531, -77.4565, 3],
  ['LAS', 'Las Vegas', 'US', 36.084, -115.1537, 3],
  ['PHX', 'Phoenix', 'US', 33.4352, -112.0101, 3],
  ['MSP', 'Minneapolis', 'US', 44.8848, -93.2223, 3],
  ['DTW', 'Detroit', 'US', 42.2162, -83.3554, 3],
  ['YVR', 'Vancouver', 'CA', 49.1967, -123.1815, 3],
  ['YUL', 'Montreal', 'CA', 45.4706, -73.7408, 3],
  ['CUN', 'Cancún', 'MX', 21.0365, -86.8771, 3],
  ['PTY', 'Panama City', 'PA', 9.0714, -79.3835, 3],
  ['ANC', 'Anchorage', 'US', 61.1743, -149.9982, 2],
  ['YYC', 'Calgary', 'CA', 51.1215, -114.0076, 2],
  ['GDL', 'Guadalajara', 'MX', 20.5218, -103.3112, 2],
  ['SJU', 'San Juan', 'PR', 18.4394, -66.0018, 2],
  ['HAV', 'Havana', 'CU', 22.9892, -82.4091, 1],
  ['SJO', 'San José', 'CR', 9.9939, -84.2088, 1],

  // South America
  ['GRU', 'São Paulo', 'BR', -23.4356, -46.4731, 5],
  ['BOG', 'Bogotá', 'CO', 4.7016, -74.1469, 4],
  ['EZE', 'Buenos Aires', 'AR', -34.8222, -58.5358, 4],
  ['LIM', 'Lima', 'PE', -12.0219, -77.1143, 3],
  ['GIG', 'Rio de Janeiro', 'BR', -22.81, -43.2506, 3],
  ['SCL', 'Santiago', 'CL', -33.393, -70.7858, 3],
  ['BSB', 'Brasília', 'BR', -15.8711, -47.9186, 2],
  ['UIO', 'Quito', 'EC', -0.1292, -78.3575, 1],
  ['CCS', 'Caracas', 'VE', 10.6012, -66.9913, 1],
  ['MAO', 'Manaus', 'BR', -3.0386, -60.0497, 1],
  ['MVD', 'Montevideo', 'UY', -34.8384, -56.0308, 1],
  ['LPB', 'La Paz', 'BO', -16.5133, -68.1923, 1],
  ['USH', 'Ushuaia', 'AR', -54.8433, -68.2958, 1],
  // ---- second wave: more of Europe ----
  ['HAM', 'Hamburg', 'DE', 53.63, 9.99, 3], ['BER', 'Berlin', 'DE', 52.37, 13.5, 3], ['DUS', 'Düsseldorf', 'DE', 51.29, 6.77, 3],
  ['STR', 'Stuttgart', 'DE', 48.69, 9.22, 2], ['CGN', 'Cologne', 'DE', 50.87, 7.14, 2],
  ['LYS', 'Lyon', 'FR', 45.73, 5.08, 2], ['MRS', 'Marseille', 'FR', 43.44, 5.22, 2], ['TLS', 'Toulouse', 'FR', 43.63, 1.37, 2],
  ['BOD', 'Bordeaux', 'FR', 44.83, -0.72, 1], ['NTE', 'Nantes', 'FR', 47.16, -1.61, 1],
  ['AGP', 'Málaga', 'ES', 36.67, -4.5, 3], ['PMI', 'Palma de Mallorca', 'ES', 39.55, 2.74, 3], ['ALC', 'Alicante', 'ES', 38.28, -0.56, 2],
  ['VLC', 'Valencia', 'ES', 39.49, -0.48, 2], ['SVQ', 'Seville', 'ES', 37.42, -5.89, 2], ['BIO', 'Bilbao', 'ES', 43.3, -2.91, 1],
  ['LPA', 'Gran Canaria', 'ES', 27.93, -15.39, 2], ['TFS', 'Tenerife', 'ES', 28.04, -16.57, 2],
  ['OPO', 'Porto', 'PT', 41.24, -8.68, 2], ['FAO', 'Faro', 'PT', 37.01, -7.97, 1], ['FNC', 'Madeira', 'PT', 32.69, -16.77, 1],
  ['PDL', 'Azores', 'PT', 37.74, -25.7, 1],
  ['VCE', 'Venice', 'IT', 45.51, 12.35, 2], ['NAP', 'Naples', 'IT', 40.88, 14.29, 2], ['BLQ', 'Bologna', 'IT', 44.53, 11.29, 1],
  ['CTA', 'Catania', 'IT', 37.47, 15.07, 2], ['PMO', 'Palermo', 'IT', 38.18, 13.09, 1], ['MLA', 'Malta', 'MT', 35.86, 14.48, 1],
  ['SKG', 'Thessaloniki', 'GR', 40.52, 22.97, 1], ['HER', 'Heraklion', 'GR', 35.34, 25.18, 2],
  ['AYT', 'Antalya', 'TR', 36.9, 30.8, 3], ['ESB', 'Ankara', 'TR', 40.13, 32.99, 2], ['ADB', 'Izmir', 'TR', 38.29, 27.16, 2],
  ['LCA', 'Larnaca', 'CY', 34.88, 33.62, 1],
  ['BGO', 'Bergen', 'NO', 60.29, 5.22, 1], ['TOS', 'Tromsø', 'NO', 69.68, 18.92, 1], ['GOT', 'Gothenburg', 'SE', 57.66, 12.29, 2],
  ['RIX', 'Riga', 'LV', 56.92, 23.97, 1], ['TLL', 'Tallinn', 'EE', 59.41, 24.83, 1], ['VNO', 'Vilnius', 'LT', 54.63, 25.29, 1],
  ['KRK', 'Kraków', 'PL', 50.08, 19.78, 2], ['GDN', 'Gdańsk', 'PL', 54.38, 18.47, 1], ['CLJ', 'Cluj-Napoca', 'RO', 46.79, 23.69, 1],
  ['SPU', 'Split', 'HR', 43.54, 16.3, 1], ['DBV', 'Dubrovnik', 'HR', 42.56, 18.27, 1], ['INI', 'Niš', 'RS', 43.34, 21.85, 1],
  ['PRN', 'Pristina', 'XK', 42.57, 21.04, 1], ['KIV', 'Chișinău', 'MD', 46.93, 28.93, 1], ['MSQ', 'Minsk', 'BY', 53.88, 28.03, 1],
  ['GLA', 'Glasgow', 'GB', 55.87, -4.43, 2], ['BHX', 'Birmingham', 'GB', 52.45, -1.75, 2], ['BFS', 'Belfast', 'GB', 54.66, -6.22, 1],
  ['LUX', 'Luxembourg', 'LU', 49.63, 6.2, 1], ['BSL', 'Basel', 'CH', 47.59, 7.53, 1],

  // ---- Russia, Caucasus, Central Asia ----
  ['SVX', 'Yekaterinburg', 'RU', 56.74, 60.8, 2], ['KZN', 'Kazan', 'RU', 55.61, 49.28, 1], ['AER', 'Sochi', 'RU', 43.45, 39.96, 2],
  ['KJA', 'Krasnoyarsk', 'RU', 56.17, 92.49, 1], ['IKT', 'Irkutsk', 'RU', 52.27, 104.39, 1], ['KHV', 'Khabarovsk', 'RU', 48.53, 135.19, 1],
  ['PKC', 'Petropavlovsk', 'RU', 53.17, 158.45, 1], ['YKS', 'Yakutsk', 'RU', 62.09, 129.77, 1],
  ['TBS', 'Tbilisi', 'GE', 41.67, 44.95, 1], ['EVN', 'Yerevan', 'AM', 40.15, 44.4, 1], ['GYD', 'Baku', 'AZ', 40.47, 50.05, 2],
  ['NQZ', 'Astana', 'KZ', 51.02, 71.47, 1], ['FRU', 'Bishkek', 'KG', 43.06, 74.48, 1], ['DYU', 'Dushanbe', 'TJ', 38.54, 68.82, 1],
  ['ASB', 'Ashgabat', 'TM', 37.99, 58.36, 1],

  // ---- more of the Middle East ----
  ['KWI', 'Kuwait City', 'KW', 29.23, 47.97, 3], ['BAH', 'Bahrain', 'BH', 26.27, 50.63, 2], ['MCT', 'Muscat', 'OM', 23.59, 58.28, 2],
  ['AMM', 'Amman', 'JO', 31.72, 35.99, 2], ['BEY', 'Beirut', 'LB', 33.82, 35.49, 2], ['BGW', 'Baghdad', 'IQ', 33.26, 44.23, 2],
  ['MED', 'Medina', 'SA', 24.55, 39.71, 2], ['DMM', 'Dammam', 'SA', 26.47, 49.8, 2], ['KBL', 'Kabul', 'AF', 34.57, 69.21, 1],

  // ---- more of Africa ----
  ['HRG', 'Hurghada', 'EG', 27.18, 33.8, 1], ['RAK', 'Marrakech', 'MA', 31.61, -8.04, 2], ['KRT', 'Khartoum', 'SD', 15.59, 32.55, 1],
  ['ABV', 'Abuja', 'NG', 9.01, 7.26, 2], ['ABJ', 'Abidjan', 'CI', 5.26, -3.93, 2], ['DLA', 'Douala', 'CM', 4.01, 9.72, 1],
  ['FIH', 'Kinshasa', 'CD', -4.39, 15.44, 2], ['EBB', 'Entebbe', 'UG', 0.04, 32.44, 1], ['KGL', 'Kigali', 'RW', -1.97, 30.14, 1],
  ['ZNZ', 'Zanzibar', 'TZ', -6.22, 39.22, 1], ['LUN', 'Lusaka', 'ZM', -15.33, 28.45, 1], ['HRE', 'Harare', 'ZW', -17.93, 31.09, 1],
  ['MPM', 'Maputo', 'MZ', -25.92, 32.57, 1], ['WDH', 'Windhoek', 'NA', -22.48, 17.47, 1], ['DUR', 'Durban', 'ZA', -29.61, 31.12, 2],
  ['GBE', 'Gaborone', 'BW', -24.56, 25.92, 1], ['SEZ', 'Seychelles', 'SC', -4.67, 55.52, 1], ['BKO', 'Bamako', 'ML', 12.53, -7.95, 1],
  ['OUA', 'Ouagadougou', 'BF', 12.35, -1.51, 1], ['NIM', 'Niamey', 'NE', 13.48, 2.18, 1], ['NDJ', 'N’Djamena', 'TD', 12.13, 15.03, 1],
  ['LBV', 'Libreville', 'GA', 0.46, 9.41, 1], ['ROB', 'Monrovia', 'LR', 6.23, -10.36, 1], ['FNA', 'Freetown', 'SL', 8.62, -13.2, 1],
  ['CKY', 'Conakry', 'GN', 9.58, -13.61, 1], ['NKC', 'Nouakchott', 'MR', 18.31, -15.97, 1], ['RAI', 'Praia', 'CV', 14.92, -23.49, 1],
  ['JIB', 'Djibouti', 'DJ', 11.55, 43.16, 1], ['MGQ', 'Mogadishu', 'SO', 2.01, 45.3, 1],

  // ---- more of South and Southeast Asia ----
  ['HYD', 'Hyderabad', 'IN', 17.24, 78.43, 3], ['AMD', 'Ahmedabad', 'IN', 23.07, 72.63, 2], ['COK', 'Kochi', 'IN', 10.15, 76.4, 2],
  ['GOI', 'Goa', 'IN', 15.38, 73.83, 2], ['PNQ', 'Pune', 'IN', 18.58, 73.92, 2], ['LKO', 'Lucknow', 'IN', 26.76, 80.89, 1],
  ['JAI', 'Jaipur', 'IN', 26.82, 75.81, 1], ['LHE', 'Lahore', 'PK', 31.52, 74.4, 2], ['CGP', 'Chittagong', 'BD', 22.25, 91.81, 1],
  ['PBH', 'Paro', 'BT', 27.4, 89.42, 1],
  ['HKT', 'Phuket', 'TH', 8.11, 98.32, 3], ['CNX', 'Chiang Mai', 'TH', 18.77, 98.96, 2], ['RGN', 'Yangon', 'MM', 16.91, 96.13, 2],
  ['PNH', 'Phnom Penh', 'KH', 11.55, 104.84, 2], ['REP', 'Siem Reap', 'KH', 13.41, 103.81, 1], ['VTE', 'Vientiane', 'LA', 17.99, 102.56, 1],
  ['DAD', 'Da Nang', 'VN', 16.04, 108.2, 2], ['PEN', 'Penang', 'MY', 5.3, 100.28, 2], ['BKI', 'Kota Kinabalu', 'MY', 5.94, 116.05, 2],
  ['KCH', 'Kuching', 'MY', 1.48, 110.35, 1], ['BWN', 'Bandar Seri Begawan', 'BN', 4.94, 114.93, 1],
  ['SUB', 'Surabaya', 'ID', -7.38, 112.79, 3], ['UPG', 'Makassar', 'ID', -5.06, 119.55, 2], ['KNO', 'Medan', 'ID', 3.64, 98.89, 2],
  ['BPN', 'Balikpapan', 'ID', -1.27, 116.89, 1], ['DJJ', 'Jayapura', 'ID', -2.58, 140.52, 1],
  ['CEB', 'Cebu', 'PH', 10.31, 123.98, 2], ['DVO', 'Davao', 'PH', 7.13, 125.65, 1], ['DIL', 'Dili', 'TL', -8.55, 125.52, 1],

  // ---- more of East Asia ----
  ['SZX', 'Shenzhen', 'CN', 22.64, 113.81, 4], ['KMG', 'Kunming', 'CN', 25.1, 102.93, 4], ['XIY', 'Xi’an', 'CN', 34.45, 108.75, 4],
  ['CKG', 'Chongqing', 'CN', 29.72, 106.64, 4], ['HGH', 'Hangzhou', 'CN', 30.23, 120.43, 4], ['WUH', 'Wuhan', 'CN', 30.78, 114.21, 3],
  ['NKG', 'Nanjing', 'CN', 31.74, 118.86, 3], ['XMN', 'Xiamen', 'CN', 24.54, 118.13, 3], ['TAO', 'Qingdao', 'CN', 36.36, 120.09, 3],
  ['CSX', 'Changsha', 'CN', 28.19, 113.22, 3], ['CGO', 'Zhengzhou', 'CN', 34.52, 113.84, 3], ['HRB', 'Harbin', 'CN', 45.62, 126.25, 2],
  ['SHE', 'Shenyang', 'CN', 41.64, 123.48, 2], ['DLC', 'Dalian', 'CN', 38.97, 121.54, 2], ['TSN', 'Tianjin', 'CN', 39.12, 117.35, 2],
  ['SYX', 'Sanya', 'CN', 18.3, 109.41, 2], ['HAK', 'Haikou', 'CN', 19.93, 110.46, 2], ['KWL', 'Guilin', 'CN', 25.22, 110.04, 1],
  ['LXA', 'Lhasa', 'CN', 29.3, 90.91, 1], ['MFM', 'Macau', 'MO', 22.15, 113.59, 2], ['KHH', 'Kaohsiung', 'TW', 22.58, 120.35, 2],
  ['FUK', 'Fukuoka', 'JP', 33.59, 130.45, 3], ['NGO', 'Nagoya', 'JP', 34.86, 136.81, 3], ['OKA', 'Okinawa', 'JP', 26.2, 127.65, 2],
  ['SDJ', 'Sendai', 'JP', 38.14, 140.92, 1], ['PUS', 'Busan', 'KR', 35.18, 128.94, 2], ['CJU', 'Jeju', 'KR', 33.51, 126.49, 3],
  ['FNJ', 'Pyongyang', 'KP', 39.22, 125.67, 1],

  // ---- more of Oceania and the Pacific ----
  ['ADL', 'Adelaide', 'AU', -34.95, 138.53, 2], ['CNS', 'Cairns', 'AU', -16.89, 145.76, 2], ['DRW', 'Darwin', 'AU', -12.41, 130.88, 1],
  ['HBA', 'Hobart', 'AU', -42.84, 147.51, 1], ['OOL', 'Gold Coast', 'AU', -28.16, 153.51, 2], ['CBR', 'Canberra', 'AU', -35.31, 149.19, 1],
  ['ASP', 'Alice Springs', 'AU', -23.81, 133.9, 1], ['WLG', 'Wellington', 'NZ', -41.33, 174.81, 2], ['ZQN', 'Queenstown', 'NZ', -45.02, 168.74, 1],
  ['NOU', 'Nouméa', 'NC', -22.01, 166.21, 1], ['APW', 'Apia', 'WS', -13.83, -172.01, 1], ['GUM', 'Guam', 'GU', 13.48, 144.8, 1],
  ['RAR', 'Rarotonga', 'CK', -21.2, -159.81, 1], ['VLI', 'Port Vila', 'VU', -17.7, 168.32, 1], ['HIR', 'Honiara', 'SB', -9.43, 160.05, 1],
  ['TBU', 'Nukuʻalofa', 'TO', -21.24, -175.15, 1], ['IPC', 'Easter Island', 'CL', -27.16, -109.42, 1],

  // ---- more of North America ----
  ['CLT', 'Charlotte', 'US', 35.21, -80.94, 4], ['MCO', 'Orlando', 'US', 28.43, -81.31, 4], ['PHL', 'Philadelphia', 'US', 39.87, -75.24, 3],
  ['SLC', 'Salt Lake City', 'US', 40.79, -111.98, 3], ['SAN', 'San Diego', 'US', 32.73, -117.19, 3], ['TPA', 'Tampa', 'US', 27.98, -82.53, 3],
  ['PDX', 'Portland', 'US', 45.59, -122.6, 3], ['BNA', 'Nashville', 'US', 36.12, -86.68, 3], ['AUS', 'Austin', 'US', 30.19, -97.67, 3],
  ['STL', 'St Louis', 'US', 38.75, -90.37, 2], ['MCI', 'Kansas City', 'US', 39.3, -94.71, 2], ['MSY', 'New Orleans', 'US', 29.99, -90.26, 2],
  ['RDU', 'Raleigh', 'US', 35.88, -78.79, 2], ['PIT', 'Pittsburgh', 'US', 40.49, -80.23, 2], ['CLE', 'Cleveland', 'US', 41.41, -81.85, 2],
  ['CVG', 'Cincinnati', 'US', 39.05, -84.67, 2], ['IND', 'Indianapolis', 'US', 39.72, -86.29, 2], ['SAT', 'San Antonio', 'US', 29.53, -98.47, 2],
  ['MEM', 'Memphis', 'US', 35.04, -89.98, 2], ['ABQ', 'Albuquerque', 'US', 35.04, -106.61, 1], ['BOI', 'Boise', 'US', 43.56, -116.22, 1],
  ['OMA', 'Omaha', 'US', 41.3, -95.89, 1], ['JAX', 'Jacksonville', 'US', 30.49, -81.69, 1], ['FAI', 'Fairbanks', 'US', 64.82, -147.86, 1],
  ['JNU', 'Juneau', 'US', 58.35, -134.58, 1], ['OGG', 'Maui', 'US', 20.9, -156.43, 2], ['KOA', 'Kona', 'US', 19.74, -156.05, 1],
  ['YEG', 'Edmonton', 'CA', 53.31, -113.58, 2], ['YOW', 'Ottawa', 'CA', 45.32, -75.67, 2], ['YWG', 'Winnipeg', 'CA', 49.91, -97.24, 2],
  ['YHZ', 'Halifax', 'CA', 44.88, -63.51, 1], ['YQB', 'Quebec City', 'CA', 46.79, -71.39, 1], ['YYT', 'St John’s', 'CA', 47.62, -52.75, 1],
  ['YXE', 'Saskatoon', 'CA', 52.17, -106.7, 1], ['YZF', 'Yellowknife', 'CA', 62.46, -114.44, 1], ['YXY', 'Whitehorse', 'CA', 60.71, -135.07, 1],
  ['YFB', 'Iqaluit', 'CA', 63.76, -68.56, 1], ['GOH', 'Nuuk', 'GL', 64.19, -51.68, 1],

  // ---- more of Mexico, Central America and the Caribbean ----
  ['MTY', 'Monterrey', 'MX', 25.78, -100.11, 3], ['TIJ', 'Tijuana', 'MX', 32.54, -116.97, 2], ['SJD', 'Los Cabos', 'MX', 23.15, -109.72, 2],
  ['PVR', 'Puerto Vallarta', 'MX', 20.68, -105.25, 2], ['MID', 'Mérida', 'MX', 20.94, -89.66, 1],
  ['GUA', 'Guatemala City', 'GT', 14.58, -90.53, 2], ['SAL', 'San Salvador', 'SV', 13.44, -89.06, 1], ['SAP', 'San Pedro Sula', 'HN', 15.45, -87.92, 1],
  ['MGA', 'Managua', 'NI', 12.14, -86.17, 1], ['BZE', 'Belize City', 'BZ', 17.54, -88.31, 1],
  ['NAS', 'Nassau', 'BS', 25.04, -77.47, 2], ['MBJ', 'Montego Bay', 'JM', 18.5, -77.91, 2], ['KIN', 'Kingston', 'JM', 17.94, -76.79, 1],
  ['PUJ', 'Punta Cana', 'DO', 18.57, -68.36, 3], ['SDQ', 'Santo Domingo', 'DO', 18.43, -69.67, 2], ['PAP', 'Port-au-Prince', 'HT', 18.58, -72.29, 1],
  ['BGI', 'Barbados', 'BB', 13.07, -59.49, 1], ['POS', 'Port of Spain', 'TT', 10.6, -61.34, 1], ['AUA', 'Aruba', 'AW', 12.5, -70.02, 1],
  ['CUR', 'Curaçao', 'CW', 12.19, -68.96, 1], ['SXM', 'Sint Maarten', 'SX', 18.04, -63.11, 1], ['BDA', 'Bermuda', 'BM', 32.36, -64.68, 1],

  // ---- more of South America ----
  ['MDE', 'Medellín', 'CO', 6.16, -75.42, 2], ['CTG', 'Cartagena', 'CO', 10.44, -75.51, 2], ['CLO', 'Cali', 'CO', 3.54, -76.38, 1],
  ['GYE', 'Guayaquil', 'EC', -2.16, -79.88, 2], ['GPS', 'Galápagos', 'EC', -0.45, -90.27, 1], ['CUZ', 'Cusco', 'PE', -13.54, -71.94, 1],
  ['VVI', 'Santa Cruz', 'BO', -17.64, -63.14, 2], ['ASU', 'Asunción', 'PY', -25.24, -57.52, 1],
  ['COR', 'Córdoba', 'AR', -31.32, -64.21, 1], ['MDZ', 'Mendoza', 'AR', -32.83, -68.79, 1], ['BRC', 'Bariloche', 'AR', -41.15, -71.16, 1],
  ['PUQ', 'Punta Arenas', 'CL', -53.0, -70.85, 1], ['ANF', 'Antofagasta', 'CL', -23.44, -70.45, 1],
  ['CNF', 'Belo Horizonte', 'BR', -19.62, -43.97, 2], ['SSA', 'Salvador', 'BR', -12.91, -38.33, 2], ['REC', 'Recife', 'BR', -8.13, -34.92, 2],
  ['FOR', 'Fortaleza', 'BR', -3.78, -38.53, 2], ['BEL', 'Belém', 'BR', -1.38, -48.48, 1], ['POA', 'Porto Alegre', 'BR', -29.99, -51.17, 2],
  ['CWB', 'Curitiba', 'BR', -25.53, -49.18, 2], ['FLN', 'Florianópolis', 'BR', -27.67, -48.55, 1], ['IGU', 'Foz do Iguaçu', 'BR', -25.6, -54.49, 1],
  ['CGB', 'Cuiabá', 'BR', -15.65, -56.12, 1], ['GEO', 'Georgetown', 'GY', 6.5, -58.25, 1], ['PBM', 'Paramaribo', 'SR', 5.45, -55.19, 1],
  ['CAY', 'Cayenne', 'GF', 4.82, -52.36, 1],
];

// Holiday destinations: demand swings much harder with the seasons.
const LEISURE = new Set(['DPS', 'CUN', 'MLE', 'HNL', 'NCE', 'PPT', 'MRU', 'NAN', 'ATH', 'LIS', 'BCN', 'MIA', 'LAS', 'SJU', 'HAV', 'CPT', 'BKK', 'GIG', 'KEF', 'DXB', 'SJO', 'CMB', 'KTM',
  'AGP', 'PMI', 'ALC', 'LPA', 'TFS', 'FAO', 'FNC', 'PDL', 'VCE', 'HER', 'AYT', 'SPU', 'DBV', 'MLA', 'LCA', 'HRG', 'RAK', 'ZNZ', 'SEZ', 'GOI', 'HKT', 'CNX',
  'REP', 'DAD', 'PEN', 'SYX', 'OKA', 'CJU', 'CNS', 'OOL', 'ZQN', 'NOU', 'APW', 'RAR', 'VLI', 'IPC', 'GUM', 'OGG', 'KOA', 'MCO', 'SJD', 'PVR', 'NAS', 'MBJ',
  'PUJ', 'BGI', 'AUA', 'CUR', 'SXM', 'BDA', 'CTG', 'CUZ', 'GPS', 'IGU', 'BRC', 'FLN']);

export const AIRPORTS = RAW.map(([id, city, country, lat, lon, size]) => {
  const airport = { id, city, country, lat, lon, size, leisure: LEISURE.has(id) };
  return { ...airport, market: characteristicsFor(airport) };
});

export const AIRPORT_BY_ID = Object.fromEntries(AIRPORTS.map((a) => [a.id, a]));

export const TIER_NAMES = ['', 'Local', 'Regional', 'Major', 'Hub', 'Mega-hub'];

// Rough continent from coordinates; good enough for "serve every continent".
export const CONTINENTS = ['Europe', 'Africa', 'Asia', 'Oceania', 'North America', 'South America'];
export function continentOf(a) {
  if (a.lon < -30) {
    if (a.lon < -120 && a.lat < 30) return 'Oceania'; // Hawaii and the Pacific islands
    return a.lat > 13 ? 'North America' : a.lon > -93 ? 'South America' : 'North America';
  }
  if (a.lon > 110 && a.lat < -8) return 'Oceania';
  if (a.lat < 0 && a.lon > 40 && a.lon < 60) return 'Africa'; // Indian Ocean islands
  if (a.lon > 140 && a.lat < 25) return 'Oceania';
  if (a.lat > 35 && a.lon < 45) return 'Europe';
  if (a.lon < 52 && a.lat <= 37 && !(a.lon > 34 && a.lat > 12)) return 'Africa';
  return 'Asia';
}
