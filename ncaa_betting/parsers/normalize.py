"""Team name normalization for NCAA Division I men's basketball.

Different data providers use varying team name formats -- abbreviations,
suffixes like "St." vs "State", mascot names, conference-based shorthands,
and casual fan-style nicknames.  This module provides a single
``canonicalize`` function that maps every known variant to one canonical
name so that records from KenPom, ATS sites, and Vegas feeds can be
joined reliably.

Public API
----------
TEAM_ALIASES : dict[str, str]
    Lowercased variant -> canonical name.
canonicalize(name)
    Deterministic, zero-dependency name resolution.
fuzzy_match(name, candidates, threshold)
    Soft matching via ``difflib.SequenceMatcher`` for cases where the
    input is close but not an exact alias.
"""

from __future__ import annotations

import difflib
import logging
import re
from functools import lru_cache
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Canonical alias map  (alias -> canonical)
#
# Keys are **lowercased, stripped** variants.  Values are the single
# canonical form used throughout the codebase and database.
#
# Organisation: grouped alphabetically by *canonical* name.  Each
# canonical name maps to itself (lower-cased) as well so that an
# already-canonical input is a hit.  Common abbreviations, mascot
# names, "St." / "State" variants, broadcaster shorthand, and
# sportsbook-specific spellings are all included.
# ---------------------------------------------------------------------------

TEAM_ALIASES: dict[str, str] = {
    # ---- A ----

    # Abilene Christian Wildcats – Southland / WAC
    "abilene christian": "Abilene Christian",
    "abilene christian wildcats": "Abilene Christian",
    "abilene chr": "Abilene Christian",
    "acu": "Abilene Christian",

    # Air Force Falcons – Mountain West
    "air force": "Air Force",
    "air force falcons": "Air Force",
    "af": "Air Force",

    # Akron Zips – MAC
    "akron": "Akron",
    "akron zips": "Akron",

    # Alabama Crimson Tide – SEC
    "alabama": "Alabama",
    "alabama crimson tide": "Alabama",
    "bama": "Alabama",
    "ua": "Alabama",
    "ala": "Alabama",

    # Alabama A&M Bulldogs – SWAC
    "alabama a&m": "Alabama A&M",
    "alabama a and m": "Alabama A&M",
    "aamu": "Alabama A&M",
    "alabama am": "Alabama A&M",
    "alabama a&m bulldogs": "Alabama A&M",

    # Alabama State Hornets – SWAC
    "alabama state": "Alabama St.",
    "alabama st": "Alabama St.",
    "alabama st.": "Alabama St.",
    "alabama state hornets": "Alabama St.",
    "alst": "Alabama St.",

    # Albany Great Danes – America East
    "albany": "Albany",
    "albany great danes": "Albany",
    "ualbany": "Albany",
    "suny albany": "Albany",

    # Alcorn State Braves – SWAC
    "alcorn state": "Alcorn St.",
    "alcorn st": "Alcorn St.",
    "alcorn st.": "Alcorn St.",
    "alcorn": "Alcorn St.",

    # American Eagles – Patriot
    "american": "American",
    "american university": "American",
    "american eagles": "American",
    "american u": "American",

    # Appalachian State Mountaineers – Sun Belt
    "appalachian state": "Appalachian St.",
    "appalachian st": "Appalachian St.",
    "appalachian st.": "Appalachian St.",
    "app state": "Appalachian St.",
    "app st": "Appalachian St.",
    "app st.": "Appalachian St.",

    # Arizona Wildcats – Big 12
    "arizona": "Arizona",
    "arizona wildcats": "Arizona",
    "ariz": "Arizona",
    "zona": "Arizona",

    # Arizona State Sun Devils – Big 12
    "arizona state": "Arizona St.",
    "arizona st": "Arizona St.",
    "arizona st.": "Arizona St.",
    "asu": "Arizona St.",
    "arizona state sun devils": "Arizona St.",
    "az state": "Arizona St.",

    # Arkansas Razorbacks – SEC
    "arkansas": "Arkansas",
    "arkansas razorbacks": "Arkansas",
    "ark": "Arkansas",
    "razorbacks": "Arkansas",

    # Arkansas-Pine Bluff Golden Lions – SWAC
    "arkansas-pine bluff": "Arkansas-Pine Bluff",
    "arkansas pine bluff": "Arkansas-Pine Bluff",
    "ar-pine bluff": "Arkansas-Pine Bluff",
    "uapb": "Arkansas-Pine Bluff",
    "ark-pine bluff": "Arkansas-Pine Bluff",
    "ark pine bluff": "Arkansas-Pine Bluff",
    "ark. pine bluff": "Arkansas-Pine Bluff",

    # Arkansas State Red Wolves – Sun Belt
    "arkansas state": "Arkansas St.",
    "arkansas st": "Arkansas St.",
    "arkansas st.": "Arkansas St.",
    "ark state": "Arkansas St.",
    "a-state": "Arkansas St.",

    # Army Black Knights – Patriot
    "army": "Army",
    "army black knights": "Army",
    "army west point": "Army",

    # Auburn Tigers – SEC
    "auburn": "Auburn",
    "auburn tigers": "Auburn",
    "aub": "Auburn",

    # Austin Peay Governors – ASUN
    "austin peay": "Austin Peay",
    "austin peay governors": "Austin Peay",
    "austin peay state": "Austin Peay",
    "apsu": "Austin Peay",

    # ---- B ----

    # Ball State Cardinals – MAC
    "ball state": "Ball St.",
    "ball st": "Ball St.",
    "ball st.": "Ball St.",
    "ball state cardinals": "Ball St.",

    # Baylor Bears – Big 12
    "baylor": "Baylor",
    "baylor bears": "Baylor",
    "bay": "Baylor",

    # Bellarmine Knights – ASUN
    "bellarmine": "Bellarmine",
    "bellarmine knights": "Bellarmine",

    # Belmont Bruins – MVC
    "belmont": "Belmont",
    "belmont bruins": "Belmont",

    # Bethune-Cookman Wildcats – SWAC
    "bethune-cookman": "Bethune-Cookman",
    "bethune cookman": "Bethune-Cookman",
    "b-cu": "Bethune-Cookman",
    "bcu": "Bethune-Cookman",
    "b-cookman": "Bethune-Cookman",

    # Binghamton Bearcats – America East
    "binghamton": "Binghamton",
    "binghamton bearcats": "Binghamton",
    "suny binghamton": "Binghamton",

    # Boise State Broncos – Mountain West
    "boise state": "Boise St.",
    "boise st": "Boise St.",
    "boise st.": "Boise St.",
    "boise": "Boise St.",
    "boise state broncos": "Boise St.",

    # Boston College Eagles – ACC
    "boston college": "Boston College",
    "boston college eagles": "Boston College",
    "bc": "Boston College",
    "b.c.": "Boston College",

    # Boston University Terriers – Patriot
    "boston university": "Boston University",
    "boston u": "Boston University",
    "bu": "Boston University",
    "boston university terriers": "Boston University",

    # Bowling Green Falcons – MAC
    "bowling green": "Bowling Green",
    "bowling green state": "Bowling Green",
    "bowling green falcons": "Bowling Green",
    "bgsu": "Bowling Green",
    "bg": "Bowling Green",

    # Bradley Braves – MVC
    "bradley": "Bradley",
    "bradley braves": "Bradley",

    # Brown Bears – Ivy
    "brown": "Brown",
    "brown bears": "Brown",

    # Bryant Bulldogs – America East
    "bryant": "Bryant",
    "bryant bulldogs": "Bryant",

    # Bucknell Bison – Patriot
    "bucknell": "Bucknell",
    "bucknell bison": "Bucknell",

    # Buffalo Bulls – MAC
    "buffalo": "Buffalo",
    "buffalo bulls": "Buffalo",
    "ub": "Buffalo",

    # Butler Bulldogs – Big East
    "butler": "Butler",
    "butler bulldogs": "Butler",

    # BYU Cougars – Big 12
    "byu": "BYU",
    "brigham young": "BYU",
    "brigham young university": "BYU",
    "brigham young cougars": "BYU",
    "byu cougars": "BYU",
    "b.y.u.": "BYU",

    # ---- C ----

    # Cal Poly Mustangs – Big West
    "cal poly": "Cal Poly",
    "cal poly mustangs": "Cal Poly",
    "cal poly slo": "Cal Poly",
    "cal poly san luis obispo": "Cal Poly",

    # Cal State Bakersfield Roadrunners – Big West
    "cal st. bakersfield": "Cal St. Bakersfield",
    "cal state bakersfield": "Cal St. Bakersfield",
    "csub": "Cal St. Bakersfield",
    "cs bakersfield": "Cal St. Bakersfield",
    "bakersfield": "Cal St. Bakersfield",
    "csu bakersfield": "Cal St. Bakersfield",

    # Cal State Fullerton Titans – Big West
    "cal st. fullerton": "Cal St. Fullerton",
    "cal state fullerton": "Cal St. Fullerton",
    "csuf": "Cal St. Fullerton",
    "cs fullerton": "Cal St. Fullerton",
    "fullerton": "Cal St. Fullerton",
    "csu fullerton": "Cal St. Fullerton",

    # Cal State Northridge Matadors – Big West
    "cal st. northridge": "Cal St. Northridge",
    "cal state northridge": "Cal St. Northridge",
    "csun": "Cal St. Northridge",
    "cs northridge": "Cal St. Northridge",
    "northridge": "Cal St. Northridge",
    "csu northridge": "Cal St. Northridge",

    # California Golden Bears – ACC
    "california": "California",
    "cal": "California",
    "california golden bears": "California",
    "cal bears": "California",
    "uc berkeley": "California",
    "berkeley": "California",

    # California Baptist Lancers – WAC
    "california baptist": "Cal Baptist",
    "cal baptist": "Cal Baptist",
    "cbu": "Cal Baptist",

    # Campbell Fighting Camels – CAA
    "campbell": "Campbell",
    "campbell fighting camels": "Campbell",

    # Canisius Golden Griffins – MAAC
    "canisius": "Canisius",
    "canisius golden griffins": "Canisius",

    # Central Arkansas Bears – ASUN
    "central arkansas": "Central Arkansas",
    "uca": "Central Arkansas",
    "cent arkansas": "Central Arkansas",

    # Central Connecticut State Blue Devils – NEC
    "central connecticut": "Central Connecticut",
    "central connecticut state": "Central Connecticut",
    "central connecticut st.": "Central Connecticut",
    "central conn st": "Central Connecticut",
    "central conn st.": "Central Connecticut",
    "ccsu": "Central Connecticut",
    "central conn": "Central Connecticut",

    # UCF Knights – Big 12
    "central florida": "UCF",
    "ucf": "UCF",
    "ucf knights": "UCF",
    "central florida knights": "UCF",

    # Central Michigan Chippewas – MAC
    "central michigan": "Central Michigan",
    "central mich": "Central Michigan",
    "cmu": "Central Michigan",
    "cent michigan": "Central Michigan",
    "central michigan chippewas": "Central Michigan",

    # Charleston Cougars – CAA
    "charleston": "Charleston",
    "college of charleston": "Charleston",
    "charleston cougars": "Charleston",
    "coll of charleston": "Charleston",
    "cofc": "Charleston",

    # Charleston Southern Buccaneers – Big South
    "charleston southern": "Charleston Southern",
    "charleston so": "Charleston Southern",
    "charleston southern buccaneers": "Charleston Southern",

    # Charlotte 49ers – AAC
    "charlotte": "Charlotte",
    "charlotte 49ers": "Charlotte",
    "unc charlotte": "Charlotte",
    "uncc": "Charlotte",

    # Chattanooga Mocs – SoCon
    "chattanooga": "Chattanooga",
    "chattanooga mocs": "Chattanooga",
    "ut chattanooga": "Chattanooga",
    "utc": "Chattanooga",

    # Chicago State Cougars – NEC
    "chicago state": "Chicago St.",
    "chicago st": "Chicago St.",
    "chicago st.": "Chicago St.",

    # Cincinnati Bearcats – Big 12
    "cincinnati": "Cincinnati",
    "cincinnati bearcats": "Cincinnati",
    "cincy": "Cincinnati",
    "cincinatti": "Cincinnati",
    "cinci": "Cincinnati",

    # Clemson Tigers – ACC
    "clemson": "Clemson",
    "clemson tigers": "Clemson",
    "clem": "Clemson",

    # Cleveland State Vikings – Horizon
    "cleveland state": "Cleveland St.",
    "cleveland st": "Cleveland St.",
    "cleveland st.": "Cleveland St.",
    "cleveland state vikings": "Cleveland St.",

    # Coastal Carolina Chanticleers – Sun Belt
    "coastal carolina": "Coastal Carolina",
    "coastal carolina chanticleers": "Coastal Carolina",
    "ccu": "Coastal Carolina",
    "coastal": "Coastal Carolina",

    # Colgate Raiders – Patriot
    "colgate": "Colgate",
    "colgate raiders": "Colgate",

    # Colorado Buffaloes – Big 12
    "colorado": "Colorado",
    "colorado buffaloes": "Colorado",
    "colorado buffs": "Colorado",
    "cu": "Colorado",
    "colo": "Colorado",
    "cu boulder": "Colorado",

    # Colorado State Rams – Mountain West
    "colorado state": "Colorado St.",
    "colorado st": "Colorado St.",
    "colorado st.": "Colorado St.",
    "colo state": "Colorado St.",
    "colo st": "Colorado St.",
    "colorado state rams": "Colorado St.",

    # Columbia Lions – Ivy
    "columbia": "Columbia",
    "columbia lions": "Columbia",

    # Connecticut Huskies – Big East
    "connecticut": "Connecticut",
    "connecticut huskies": "Connecticut",
    "uconn": "Connecticut",
    "u conn": "Connecticut",
    "conn": "Connecticut",
    "uconn huskies": "Connecticut",

    # Coppin State Eagles – MEAC
    "coppin state": "Coppin St.",
    "coppin st": "Coppin St.",
    "coppin st.": "Coppin St.",
    "coppin": "Coppin St.",

    # Cornell Big Red – Ivy
    "cornell": "Cornell",
    "cornell big red": "Cornell",

    # Creighton Bluejays – Big East
    "creighton": "Creighton",
    "creighton bluejays": "Creighton",

    # ---- D ----

    # Dartmouth Big Green – Ivy
    "dartmouth": "Dartmouth",
    "dartmouth big green": "Dartmouth",

    # Davidson Wildcats – A-10
    "davidson": "Davidson",
    "davidson wildcats": "Davidson",

    # Dayton Flyers – A-10
    "dayton": "Dayton",
    "dayton flyers": "Dayton",

    # Delaware Fightin' Blue Hens – CAA
    "delaware": "Delaware",
    "delaware blue hens": "Delaware",

    # Delaware State Hornets – MEAC
    "delaware state": "Delaware St.",
    "delaware st": "Delaware St.",
    "delaware st.": "Delaware St.",
    "del state": "Delaware St.",
    "del st": "Delaware St.",

    # Denver Pioneers – Summit
    "denver": "Denver",
    "denver pioneers": "Denver",

    # DePaul Blue Demons – Big East
    "depaul": "DePaul",
    "de paul": "DePaul",
    "depaul blue demons": "DePaul",

    # Detroit Mercy Titans – Horizon
    "detroit mercy": "Detroit Mercy",
    "detroit": "Detroit Mercy",
    "detroit mercy titans": "Detroit Mercy",
    "udm": "Detroit Mercy",

    # Drake Bulldogs – MVC
    "drake": "Drake",
    "drake bulldogs": "Drake",

    # Drexel Dragons – CAA
    "drexel": "Drexel",
    "drexel dragons": "Drexel",

    # Duke Blue Devils – ACC
    "duke": "Duke",
    "duke blue devils": "Duke",

    # Duquesne Dukes – A-10
    "duquesne": "Duquesne",
    "duquesne dukes": "Duquesne",

    # ---- E ----

    # East Carolina Pirates – AAC
    "east carolina": "East Carolina",
    "ecu": "East Carolina",
    "east carolina pirates": "East Carolina",
    "e carolina": "East Carolina",

    # East Tennessee State Buccaneers – SoCon
    "east tennessee state": "East Tennessee St.",
    "east tennessee st.": "East Tennessee St.",
    "east tennessee st": "East Tennessee St.",
    "etsu": "East Tennessee St.",
    "east tenn st": "East Tennessee St.",
    "east tenn st.": "East Tennessee St.",
    "e tennessee st": "East Tennessee St.",

    # Eastern Illinois Panthers – OVC
    "eastern illinois": "Eastern Illinois",
    "eastern ill": "Eastern Illinois",
    "eiu": "Eastern Illinois",
    "e illinois": "Eastern Illinois",

    # Eastern Kentucky Colonels – ASUN
    "eastern kentucky": "Eastern Kentucky",
    "eastern ky": "Eastern Kentucky",
    "eku": "Eastern Kentucky",
    "e kentucky": "Eastern Kentucky",

    # Eastern Michigan Eagles – MAC
    "eastern michigan": "Eastern Michigan",
    "eastern mich": "Eastern Michigan",
    "emu": "Eastern Michigan",
    "e michigan": "Eastern Michigan",

    # Eastern Washington Eagles – Big Sky
    "eastern washington": "Eastern Washington",
    "eastern wash": "Eastern Washington",
    "ewu": "Eastern Washington",
    "e washington": "Eastern Washington",

    # Elon Phoenix – CAA
    "elon": "Elon",
    "elon phoenix": "Elon",

    # Evansville Purple Aces – MVC
    "evansville": "Evansville",
    "evansville purple aces": "Evansville",

    # ---- F ----

    # Fairfield Stags – MAAC
    "fairfield": "Fairfield",
    "fairfield stags": "Fairfield",

    # Fairleigh Dickinson Knights – NEC
    "fairleigh dickinson": "Fairleigh Dickinson",
    "fdu": "Fairleigh Dickinson",
    "fairleigh dickinson knights": "Fairleigh Dickinson",

    # Florida Gators – SEC
    "florida": "Florida",
    "florida gators": "Florida",
    "uf": "Florida",
    "fla": "Florida",
    "gators": "Florida",

    # Florida A&M Rattlers – SWAC
    "florida a&m": "Florida A&M",
    "florida a and m": "Florida A&M",
    "famu": "Florida A&M",
    "florida am": "Florida A&M",

    # Florida Atlantic Owls – AAC
    "florida atlantic": "Florida Atlantic",
    "fau": "Florida Atlantic",
    "fla atlantic": "Florida Atlantic",
    "florida atlantic owls": "Florida Atlantic",

    # Florida Gulf Coast Eagles – ASUN
    "florida gulf coast": "Florida Gulf Coast",
    "fgcu": "Florida Gulf Coast",
    "fla gulf coast": "Florida Gulf Coast",
    "florida gulf coast eagles": "Florida Gulf Coast",

    # FIU Panthers – CUSA
    "florida international": "FIU",
    "fiu": "FIU",
    "fiu panthers": "FIU",
    "florida intl": "FIU",

    # Florida State Seminoles – ACC
    "florida state": "Florida St.",
    "florida st": "Florida St.",
    "florida st.": "Florida St.",
    "fsu": "Florida St.",
    "florida state seminoles": "Florida St.",
    "fla state": "Florida St.",
    "fla st": "Florida St.",
    "noles": "Florida St.",
    "seminoles": "Florida St.",

    # Fordham Rams – A-10
    "fordham": "Fordham",
    "fordham rams": "Fordham",

    # Fresno State Bulldogs – Mountain West
    "fresno state": "Fresno St.",
    "fresno st": "Fresno St.",
    "fresno st.": "Fresno St.",
    "fresno": "Fresno St.",

    # Furman Paladins – SoCon
    "furman": "Furman",
    "furman paladins": "Furman",

    # ---- G ----

    # Gardner-Webb Runnin' Bulldogs – Big South
    "gardner-webb": "Gardner-Webb",
    "gardner webb": "Gardner-Webb",
    "gwu": "Gardner-Webb",

    # George Mason Patriots – A-10
    "george mason": "George Mason",
    "george mason patriots": "George Mason",
    "gmu": "George Mason",

    # George Washington Colonials – A-10
    "george washington": "George Washington",
    "george washington colonials": "George Washington",
    "gw": "George Washington",

    # Georgetown Hoyas – Big East
    "georgetown": "Georgetown",
    "georgetown hoyas": "Georgetown",
    "gtown": "Georgetown",
    "g'town": "Georgetown",

    # Georgia Bulldogs – SEC
    "georgia": "Georgia",
    "georgia bulldogs": "Georgia",
    "uga": "Georgia",

    # Georgia Southern Eagles – Sun Belt
    "georgia southern": "Georgia Southern",
    "georgia so": "Georgia Southern",
    "ga southern": "Georgia Southern",
    "gaso": "Georgia Southern",

    # Georgia State Panthers – Sun Belt
    "georgia state": "Georgia St.",
    "georgia st": "Georgia St.",
    "georgia st.": "Georgia St.",
    "ga state": "Georgia St.",
    "gsu": "Georgia St.",

    # Georgia Tech Yellow Jackets – ACC
    "georgia tech": "Georgia Tech",
    "georgia tech yellow jackets": "Georgia Tech",
    "ga tech": "Georgia Tech",
    "gt": "Georgia Tech",
    "georgia institute of technology": "Georgia Tech",

    # Gonzaga Bulldogs – WCC
    "gonzaga": "Gonzaga",
    "gonzaga bulldogs": "Gonzaga",
    "zags": "Gonzaga",
    "gonz": "Gonzaga",

    # Grambling State Tigers – SWAC
    "grambling state": "Grambling",
    "grambling st": "Grambling",
    "grambling st.": "Grambling",
    "grambling": "Grambling",

    # Grand Canyon Antelopes – WAC
    "grand canyon": "Grand Canyon",
    "gcu": "Grand Canyon",
    "grand canyon antelopes": "Grand Canyon",

    # Green Bay Phoenix – Horizon
    "green bay": "Green Bay",
    "uw-green bay": "Green Bay",
    "uw green bay": "Green Bay",
    "uwgb": "Green Bay",
    "wisconsin-green bay": "Green Bay",

    # ---- H ----

    # Hampton Pirates – CAA
    "hampton": "Hampton",
    "hampton pirates": "Hampton",

    # Hartford Hawks – America East
    "hartford": "Hartford",
    "hartford hawks": "Hartford",

    # Harvard Crimson – Ivy
    "harvard": "Harvard",
    "harvard crimson": "Harvard",

    # Hawaii Rainbow Warriors – Big West
    "hawaii": "Hawaii",
    "hawai'i": "Hawaii",
    "hawaii rainbow warriors": "Hawaii",
    "uh": "Hawaii",

    # High Point Panthers – Big South
    "high point": "High Point",
    "high point panthers": "High Point",

    # Hofstra Pride – CAA
    "hofstra": "Hofstra",
    "hofstra pride": "Hofstra",

    # Holy Cross Crusaders – Patriot
    "holy cross": "Holy Cross",
    "holy cross crusaders": "Holy Cross",

    # Houston Cougars – Big 12
    "houston": "Houston",
    "houston cougars": "Houston",
    "hou": "Houston",

    # Houston Christian Huskies – Southland
    "houston christian": "Houston Christian",
    "houston baptist": "Houston Christian",
    "hbu": "Houston Christian",
    "hcu": "Houston Christian",

    # Howard Bison – MEAC
    "howard": "Howard",
    "howard bison": "Howard",

    # ---- I ----

    # Idaho Vandals – Big Sky
    "idaho": "Idaho",
    "idaho vandals": "Idaho",

    # Idaho State Bengals – Big Sky
    "idaho state": "Idaho St.",
    "idaho st": "Idaho St.",
    "idaho st.": "Idaho St.",

    # Illinois Fighting Illini – Big Ten
    "illinois": "Illinois",
    "illinois fighting illini": "Illinois",
    "illini": "Illinois",
    "ill": "Illinois",

    # Illinois State Redbirds – MVC
    "illinois state": "Illinois St.",
    "illinois st": "Illinois St.",
    "illinois st.": "Illinois St.",
    "il state": "Illinois St.",

    # Incarnate Word Cardinals – Southland
    "incarnate word": "Incarnate Word",
    "uiw": "Incarnate Word",

    # Indiana Hoosiers – Big Ten
    "indiana": "Indiana",
    "indiana hoosiers": "Indiana",
    "iu": "Indiana",
    "ind": "Indiana",
    "hoosiers": "Indiana",

    # Indiana State Sycamores – MVC
    "indiana state": "Indiana St.",
    "indiana st": "Indiana St.",
    "indiana st.": "Indiana St.",
    "in state": "Indiana St.",

    # Iona Gaels – MAAC
    "iona": "Iona",
    "iona gaels": "Iona",

    # Iowa Hawkeyes – Big Ten
    "iowa": "Iowa",
    "iowa hawkeyes": "Iowa",
    "hawkeyes": "Iowa",

    # Iowa State Cyclones – Big 12
    "iowa state": "Iowa St.",
    "iowa st": "Iowa St.",
    "iowa st.": "Iowa St.",
    "isu": "Iowa St.",
    "iowa state cyclones": "Iowa St.",
    "cyclones": "Iowa St.",

    # IUPUI Jaguars – Horizon
    "iupui": "IUPUI",
    "iupui jaguars": "IUPUI",

    # ---- J ----

    # Jackson State Tigers – SWAC
    "jackson state": "Jackson St.",
    "jackson st": "Jackson St.",
    "jackson st.": "Jackson St.",
    "jsu": "Jackson St.",

    # Jacksonville Dolphins – ASUN
    "jacksonville": "Jacksonville",
    "jacksonville dolphins": "Jacksonville",
    "ju": "Jacksonville",

    # Jacksonville State Gamecocks – CUSA
    "jacksonville state": "Jacksonville St.",
    "jacksonville st": "Jacksonville St.",
    "jacksonville st.": "Jacksonville St.",
    "jax state": "Jacksonville St.",

    # James Madison Dukes – Sun Belt
    "james madison": "James Madison",
    "james madison dukes": "James Madison",
    "jmu": "James Madison",

    # ---- K ----

    # Kansas Jayhawks – Big 12
    "kansas": "Kansas",
    "kansas jayhawks": "Kansas",
    "ku": "Kansas",
    "kan": "Kansas",
    "jayhawks": "Kansas",

    # Kansas State Wildcats – Big 12
    "kansas state": "Kansas St.",
    "kansas st": "Kansas St.",
    "kansas st.": "Kansas St.",
    "k-state": "Kansas St.",
    "ksu": "Kansas St.",
    "k state": "Kansas St.",
    "kansas state wildcats": "Kansas St.",

    # Kennesaw State Owls – CUSA
    "kennesaw state": "Kennesaw St.",
    "kennesaw st": "Kennesaw St.",
    "kennesaw st.": "Kennesaw St.",
    "kennesaw": "Kennesaw St.",

    # Kent State Golden Flashes – MAC
    "kent state": "Kent St.",
    "kent st": "Kent St.",
    "kent st.": "Kent St.",
    "kent": "Kent St.",

    # Kentucky Wildcats – SEC
    "kentucky": "Kentucky",
    "kentucky wildcats": "Kentucky",
    "uk": "Kentucky",
    "ky": "Kentucky",

    # ---- L ----

    # La Salle Explorers – A-10
    "la salle": "La Salle",
    "la salle explorers": "La Salle",
    "lasalle": "La Salle",

    # Lafayette Leopards – Patriot
    "lafayette": "Lafayette",
    "lafayette leopards": "Lafayette",

    # Lamar Cardinals – Southland
    "lamar": "Lamar",
    "lamar cardinals": "Lamar",

    # Lehigh Mountain Hawks – Patriot
    "lehigh": "Lehigh",
    "lehigh mountain hawks": "Lehigh",

    # Liberty Flames – CUSA
    "liberty": "Liberty",
    "liberty flames": "Liberty",

    # Lindenwood Lions – OVC
    "lindenwood": "Lindenwood",
    "lindenwood lions": "Lindenwood",

    # Lipscomb Bisons – ASUN
    "lipscomb": "Lipscomb",
    "lipscomb bisons": "Lipscomb",

    # Little Rock Trojans – OVC
    "little rock": "Little Rock",
    "ualr": "Little Rock",
    "arkansas-little rock": "Little Rock",
    "arkansas little rock": "Little Rock",
    "ua little rock": "Little Rock",

    # Long Beach State 49ers – Big West
    "long beach state": "Long Beach St.",
    "long beach st": "Long Beach St.",
    "long beach st.": "Long Beach St.",
    "lbsu": "Long Beach St.",
    "long beach": "Long Beach St.",
    "lb state": "Long Beach St.",

    # Long Island University Sharks – NEC
    "long island university": "Long Island University",
    "liu": "Long Island University",
    "long island": "Long Island University",
    "liu sharks": "Long Island University",

    # Longwood Lancers – Big South
    "longwood": "Longwood",
    "longwood lancers": "Longwood",

    # Louisiana Ragin' Cajuns – Sun Belt
    "louisiana": "Louisiana",
    "louisiana ragin' cajuns": "Louisiana",
    "louisiana ragin cajuns": "Louisiana",
    "ul lafayette": "Louisiana",
    "louisiana-lafayette": "Louisiana",
    "louisiana lafayette": "Louisiana",
    "ull": "Louisiana",

    # Louisiana-Monroe Warhawks – Sun Belt
    "louisiana-monroe": "Louisiana Monroe",
    "louisiana monroe": "Louisiana Monroe",
    "ulm": "Louisiana Monroe",
    "ul monroe": "Louisiana Monroe",

    # LSU Tigers – SEC
    "lsu": "LSU",
    "louisiana state": "LSU",
    "lsu tigers": "LSU",
    "louisiana state tigers": "LSU",

    # Louisiana Tech Bulldogs – CUSA
    "louisiana tech": "Louisiana Tech",
    "la tech": "Louisiana Tech",
    "louisiana tech bulldogs": "Louisiana Tech",

    # Louisville Cardinals – ACC
    "louisville": "Louisville",
    "louisville cardinals": "Louisville",
    "uofl": "Louisville",
    "u of l": "Louisville",
    "cards": "Louisville",

    # Loyola Chicago Ramblers – A-10
    "loyola chicago": "Loyola Chicago",
    "loyola-chicago": "Loyola Chicago",
    "loyola chi": "Loyola Chicago",
    "loyola il": "Loyola Chicago",
    "luc": "Loyola Chicago",
    "loyola ramblers": "Loyola Chicago",
    "loyola (chi)": "Loyola Chicago",
    "loyola (il)": "Loyola Chicago",

    # Loyola Marymount Lions – WCC
    "loyola marymount": "Loyola Marymount",
    "lmu": "Loyola Marymount",
    "loyola marymount lions": "Loyola Marymount",

    # Loyola (MD) Greyhounds – Patriot
    "loyola maryland": "Loyola MD",
    "loyola (md)": "Loyola MD",
    "loyola md": "Loyola MD",
    "loyola greyhounds": "Loyola MD",

    # ---- M ----

    # Maine Black Bears – America East
    "maine": "Maine",
    "maine black bears": "Maine",

    # Manhattan Jaspers – MAAC
    "manhattan": "Manhattan",
    "manhattan jaspers": "Manhattan",

    # Marist Red Foxes – MAAC
    "marist": "Marist",
    "marist red foxes": "Marist",

    # Marquette Golden Eagles – Big East
    "marquette": "Marquette",
    "marquette golden eagles": "Marquette",
    "marq": "Marquette",

    # Marshall Thundering Herd – Sun Belt
    "marshall": "Marshall",
    "marshall thundering herd": "Marshall",

    # Maryland Terrapins – Big Ten
    "maryland": "Maryland",
    "maryland terrapins": "Maryland",
    "maryland terps": "Maryland",
    "terps": "Maryland",
    "umd": "Maryland",

    # Maryland-Eastern Shore Hawks – MEAC
    "maryland-eastern shore": "Maryland Eastern Shore",
    "maryland eastern shore": "Maryland Eastern Shore",
    "umes": "Maryland Eastern Shore",
    "md eastern shore": "Maryland Eastern Shore",
    "md-eastern shore": "Maryland Eastern Shore",

    # UMass Minutemen – A-10
    "massachusetts": "Massachusetts",
    "umass": "Massachusetts",
    "umass minutemen": "Massachusetts",
    "mass": "Massachusetts",
    "u mass": "Massachusetts",

    # UMass Lowell River Hawks – America East
    "umass lowell": "UMass Lowell",
    "umass-lowell": "UMass Lowell",
    "massachusetts lowell": "UMass Lowell",
    "uml": "UMass Lowell",
    "mass lowell": "UMass Lowell",

    # McNeese Cowboys – Southland
    "mcneese": "McNeese",
    "mcneese state": "McNeese",
    "mcneese st": "McNeese",
    "mcneese st.": "McNeese",

    # Memphis Tigers – AAC
    "memphis": "Memphis",
    "memphis tigers": "Memphis",

    # Mercer Bears – SoCon
    "mercer": "Mercer",
    "mercer bears": "Mercer",

    # Merrimack Warriors – NEC
    "merrimack": "Merrimack",
    "merrimack warriors": "Merrimack",

    # Miami (FL) Hurricanes – ACC
    "miami": "Miami FL",
    "miami fl": "Miami FL",
    "miami (fl)": "Miami FL",
    "miami florida": "Miami FL",
    "miami hurricanes": "Miami FL",
    "miami (fla)": "Miami FL",
    "miami fla": "Miami FL",

    # Miami (OH) RedHawks – MAC
    "miami oh": "Miami OH",
    "miami (oh)": "Miami OH",
    "miami ohio": "Miami OH",
    "miami redhawks": "Miami OH",
    "miami of ohio": "Miami OH",
    "miami (ohio)": "Miami OH",

    # Michigan Wolverines – Big Ten
    "michigan": "Michigan",
    "michigan wolverines": "Michigan",
    "mich": "Michigan",
    "wolverines": "Michigan",

    # Michigan State Spartans – Big Ten
    "michigan state": "Michigan St.",
    "michigan st": "Michigan St.",
    "michigan st.": "Michigan St.",
    "msu": "Michigan St.",
    "mich state": "Michigan St.",
    "mich st": "Michigan St.",
    "michigan state spartans": "Michigan St.",
    "spartans": "Michigan St.",

    # Middle Tennessee Blue Raiders – CUSA
    "middle tennessee": "Middle Tennessee",
    "middle tennessee state": "Middle Tennessee",
    "middle tenn": "Middle Tennessee",
    "mtsu": "Middle Tennessee",
    "mid tennessee": "Middle Tennessee",
    "middle tenn st": "Middle Tennessee",

    # Milwaukee Panthers – Horizon
    "milwaukee": "Milwaukee",
    "uw-milwaukee": "Milwaukee",
    "uw milwaukee": "Milwaukee",
    "uwm": "Milwaukee",
    "wisconsin-milwaukee": "Milwaukee",

    # Minnesota Golden Gophers – Big Ten
    "minnesota": "Minnesota",
    "minnesota golden gophers": "Minnesota",
    "minn": "Minnesota",
    "gophers": "Minnesota",

    # Ole Miss Rebels – SEC
    "mississippi": "Ole Miss",
    "ole miss": "Ole Miss",
    "ole miss rebels": "Ole Miss",
    "miss": "Ole Miss",

    # Mississippi State Bulldogs – SEC
    "mississippi state": "Mississippi St.",
    "mississippi st": "Mississippi St.",
    "mississippi st.": "Mississippi St.",
    "miss state": "Mississippi St.",
    "miss st": "Mississippi St.",
    "miss st.": "Mississippi St.",
    "msst": "Mississippi St.",

    # Mississippi Valley State Delta Devils – SWAC
    "mississippi valley state": "Mississippi Valley St.",
    "mississippi valley st.": "Mississippi Valley St.",
    "miss valley state": "Mississippi Valley St.",
    "mississippi val": "Mississippi Valley St.",
    "mississippi valley": "Mississippi Valley St.",
    "mvsu": "Mississippi Valley St.",
    "miss valley st": "Mississippi Valley St.",

    # Missouri Tigers – SEC
    "missouri": "Missouri",
    "missouri tigers": "Missouri",
    "mizzou": "Missouri",
    "miz": "Missouri",

    # Missouri State Bears – MVC
    "missouri state": "Missouri St.",
    "missouri st": "Missouri St.",
    "missouri st.": "Missouri St.",
    "mo state": "Missouri St.",

    # Monmouth Hawks – CAA
    "monmouth": "Monmouth",
    "monmouth hawks": "Monmouth",

    # Montana Grizzlies – Big Sky
    "montana": "Montana",
    "montana grizzlies": "Montana",

    # Montana State Bobcats – Big Sky
    "montana state": "Montana St.",
    "montana st": "Montana St.",
    "montana st.": "Montana St.",

    # Morehead State Eagles – OVC
    "morehead state": "Morehead St.",
    "morehead st": "Morehead St.",
    "morehead st.": "Morehead St.",
    "morehead": "Morehead St.",

    # Morgan State Bears – MEAC
    "morgan state": "Morgan St.",
    "morgan st": "Morgan St.",
    "morgan st.": "Morgan St.",

    # Mount St. Mary's Mountaineers – MAAC
    "mount st. mary's": "Mount St. Mary's",
    "mount st mary's": "Mount St. Mary's",
    "mt st mary's": "Mount St. Mary's",
    "mt. st. mary's": "Mount St. Mary's",
    "mount st marys": "Mount St. Mary's",
    "msm": "Mount St. Mary's",

    # Murray State Racers – MVC
    "murray state": "Murray St.",
    "murray st": "Murray St.",
    "murray st.": "Murray St.",
    "murray": "Murray St.",

    # ---- N ----

    # Navy Midshipmen – Patriot
    "navy": "Navy",
    "navy midshipmen": "Navy",
    "naval academy": "Navy",

    # NC State Wolfpack – ACC
    "nc state": "NC State",
    "nc state wolfpack": "NC State",
    "north carolina state": "NC State",
    "north carolina st": "NC State",
    "n.c. state": "NC State",
    "ncsu": "NC State",
    "ncst": "NC State",
    "n carolina state": "NC State",
    "nc st": "NC State",
    "wolfpack": "NC State",

    # Nebraska Cornhuskers – Big Ten
    "nebraska": "Nebraska",
    "nebraska cornhuskers": "Nebraska",
    "neb": "Nebraska",
    "huskers": "Nebraska",

    # Nevada Wolf Pack – Mountain West
    "nevada": "Nevada",
    "nevada wolf pack": "Nevada",
    "unr": "Nevada",
    "nevada reno": "Nevada",

    # New Hampshire Wildcats – America East
    "new hampshire": "New Hampshire",
    "new hampshire wildcats": "New Hampshire",
    "unh": "New Hampshire",

    # New Mexico Lobos – Mountain West
    "new mexico": "New Mexico",
    "new mexico lobos": "New Mexico",
    "unm": "New Mexico",

    # New Mexico State Aggies – CUSA
    "new mexico state": "New Mexico St.",
    "new mexico st": "New Mexico St.",
    "new mexico st.": "New Mexico St.",
    "nmsu": "New Mexico St.",
    "nm state": "New Mexico St.",

    # New Orleans Privateers – Southland
    "new orleans": "New Orleans",
    "new orleans privateers": "New Orleans",
    "uno": "New Orleans",

    # Niagara Purple Eagles – MAAC
    "niagara": "Niagara",
    "niagara purple eagles": "Niagara",

    # Nicholls Colonels – Southland
    "nicholls": "Nicholls",
    "nicholls state": "Nicholls",
    "nicholls st": "Nicholls",
    "nicholls st.": "Nicholls",

    # NJIT Highlanders – America East
    "njit": "NJIT",
    "njit highlanders": "NJIT",
    "new jersey tech": "NJIT",

    # Norfolk State Spartans – MEAC
    "norfolk state": "Norfolk St.",
    "norfolk st": "Norfolk St.",
    "norfolk st.": "Norfolk St.",
    "nsu": "Norfolk St.",

    # North Alabama Lions – ASUN
    "north alabama": "North Alabama",
    "una": "North Alabama",
    "n alabama": "North Alabama",

    # North Carolina Tar Heels – ACC
    "north carolina": "North Carolina",
    "north carolina tar heels": "North Carolina",
    "unc": "North Carolina",
    "carolina": "North Carolina",
    "tar heels": "North Carolina",
    "n carolina": "North Carolina",

    # North Carolina A&T Aggies – CAA
    "north carolina a&t": "North Carolina A&T",
    "nc a&t": "North Carolina A&T",
    "north carolina at": "North Carolina A&T",
    "nc at": "North Carolina A&T",
    "ncat": "North Carolina A&T",
    "n carolina a&t": "North Carolina A&T",

    # North Carolina Central Eagles – MEAC
    "north carolina central": "North Carolina Central",
    "nc central": "North Carolina Central",
    "nccu": "North Carolina Central",

    # North Dakota Fighting Hawks – Summit
    "north dakota": "North Dakota",
    "north dakota fighting hawks": "North Dakota",
    "und": "North Dakota",
    "n dakota": "North Dakota",

    # North Dakota State Bison – Summit
    "north dakota state": "North Dakota St.",
    "north dakota st": "North Dakota St.",
    "north dakota st.": "North Dakota St.",
    "ndsu": "North Dakota St.",
    "n dakota state": "North Dakota St.",

    # North Florida Ospreys – ASUN
    "north florida": "North Florida",
    "unf": "North Florida",
    "n florida": "North Florida",

    # North Texas Mean Green – AAC
    "north texas": "North Texas",
    "north texas mean green": "North Texas",
    "unt": "North Texas",
    "n texas": "North Texas",

    # Northeastern Huskies – CAA
    "northeastern": "Northeastern",
    "northeastern huskies": "Northeastern",
    "neu": "Northeastern",

    # Northern Arizona Lumberjacks – Big Sky
    "northern arizona": "Northern Arizona",
    "n arizona": "Northern Arizona",
    "nau": "Northern Arizona",

    # Northern Colorado Bears – Big Sky
    "northern colorado": "Northern Colorado",
    "n colorado": "Northern Colorado",

    # Northern Illinois Huskies – MAC
    "northern illinois": "Northern Illinois",
    "n illinois": "Northern Illinois",
    "niu": "Northern Illinois",

    # Northern Iowa Panthers – MVC
    "northern iowa": "Northern Iowa",
    "uni": "Northern Iowa",
    "n iowa": "Northern Iowa",
    "northern iowa panthers": "Northern Iowa",

    # Northern Kentucky Norse – Horizon
    "northern kentucky": "Northern Kentucky",
    "n kentucky": "Northern Kentucky",
    "nku": "Northern Kentucky",

    # Northwestern Wildcats – Big Ten
    "northwestern": "Northwestern",
    "northwestern wildcats": "Northwestern",
    "nw": "Northwestern",

    # Northwestern State Demons – Southland
    "northwestern state": "Northwestern St.",
    "northwestern st": "Northwestern St.",
    "northwestern st.": "Northwestern St.",
    "nw state": "Northwestern St.",

    # Notre Dame Fighting Irish – ACC
    "notre dame": "Notre Dame",
    "notre dame fighting irish": "Notre Dame",
    "nd": "Notre Dame",
    "fighting irish": "Notre Dame",

    # ---- O ----

    # Oakland Golden Grizzlies – Horizon
    "oakland": "Oakland",
    "oakland golden grizzlies": "Oakland",
    "oakland grizzlies": "Oakland",

    # Ohio Bobcats – MAC
    "ohio": "Ohio",
    "ohio bobcats": "Ohio",
    "ohio university": "Ohio",
    "ohio u": "Ohio",

    # Ohio State Buckeyes – Big Ten
    "ohio state": "Ohio St.",
    "ohio st": "Ohio St.",
    "ohio st.": "Ohio St.",
    "osu": "Ohio St.",
    "ohio state buckeyes": "Ohio St.",
    "buckeyes": "Ohio St.",
    "the ohio state": "Ohio St.",

    # Oklahoma Sooners – SEC
    "oklahoma": "Oklahoma",
    "oklahoma sooners": "Oklahoma",
    "ou": "Oklahoma",
    "okla": "Oklahoma",
    "sooners": "Oklahoma",

    # Oklahoma State Cowboys – Big 12
    "oklahoma state": "Oklahoma St.",
    "oklahoma st": "Oklahoma St.",
    "oklahoma st.": "Oklahoma St.",
    "okla state": "Oklahoma St.",
    "okla st": "Oklahoma St.",
    "ok state": "Oklahoma St.",
    "osu cowboys": "Oklahoma St.",

    # Old Dominion Monarchs – Sun Belt
    "old dominion": "Old Dominion",
    "old dominion monarchs": "Old Dominion",
    "odu": "Old Dominion",

    # Omaha Mavericks – Summit
    "omaha": "Omaha",
    "nebraska-omaha": "Omaha",
    "nebraska omaha": "Omaha",

    # Oral Roberts Golden Eagles – Summit
    "oral roberts": "Oral Roberts",
    "oral roberts golden eagles": "Oral Roberts",
    "oru": "Oral Roberts",

    # Oregon Ducks – Big Ten
    "oregon": "Oregon",
    "oregon ducks": "Oregon",
    "ducks": "Oregon",

    # Oregon State Beavers – Pac-12
    "oregon state": "Oregon St.",
    "oregon st": "Oregon St.",
    "oregon st.": "Oregon St.",
    "osu beavers": "Oregon St.",

    # ---- P ----

    # Pacific Tigers – WCC
    "pacific": "Pacific",
    "pacific tigers": "Pacific",

    # Penn Quakers – Ivy
    "penn": "Penn",
    "penn quakers": "Penn",
    "pennsylvania": "Penn",
    "upenn": "Penn",

    # Penn State Nittany Lions – Big Ten
    "penn state": "Penn St.",
    "penn st": "Penn St.",
    "penn st.": "Penn St.",
    "psu": "Penn St.",
    "penn state nittany lions": "Penn St.",

    # Pepperdine Waves – WCC
    "pepperdine": "Pepperdine",
    "pepperdine waves": "Pepperdine",

    # Pittsburgh Panthers – ACC
    "pittsburgh": "Pittsburgh",
    "pittsburgh panthers": "Pittsburgh",
    "pitt": "Pittsburgh",

    # Portland Pilots – WCC
    "portland": "Portland",
    "portland pilots": "Portland",

    # Portland State Vikings – Big Sky
    "portland state": "Portland St.",
    "portland st": "Portland St.",
    "portland st.": "Portland St.",

    # Prairie View A&M Panthers – SWAC
    "prairie view a&m": "Prairie View A&M",
    "prairie view": "Prairie View A&M",
    "pvamu": "Prairie View A&M",
    "prairie view am": "Prairie View A&M",

    # Presbyterian Blue Hose – Big South
    "presbyterian": "Presbyterian",
    "presbyterian blue hose": "Presbyterian",

    # Princeton Tigers – Ivy
    "princeton": "Princeton",
    "princeton tigers": "Princeton",

    # Providence Friars – Big East
    "providence": "Providence",
    "providence friars": "Providence",

    # Purdue Boilermakers – Big Ten
    "purdue": "Purdue",
    "purdue boilermakers": "Purdue",
    "boilermakers": "Purdue",

    # Purdue Fort Wayne Mastodons – Horizon
    "purdue fort wayne": "Purdue Fort Wayne",
    "purdue fw": "Purdue Fort Wayne",
    "ipfw": "Purdue Fort Wayne",
    "fort wayne": "Purdue Fort Wayne",
    "pfw": "Purdue Fort Wayne",

    # ---- Q ----

    # Queens Royals – ASUN
    "queens": "Queens",
    "queens royals": "Queens",

    # Quinnipiac Bobcats – MAAC
    "quinnipiac": "Quinnipiac",
    "quinnipiac bobcats": "Quinnipiac",

    # ---- R ----

    # Radford Highlanders – Big South
    "radford": "Radford",
    "radford highlanders": "Radford",

    # Rhode Island Rams – A-10
    "rhode island": "Rhode Island",
    "rhode island rams": "Rhode Island",
    "uri": "Rhode Island",
    "r.i.": "Rhode Island",

    # Rice Owls – AAC
    "rice": "Rice",
    "rice owls": "Rice",

    # Richmond Spiders – A-10
    "richmond": "Richmond",
    "richmond spiders": "Richmond",

    # Rider Broncs – MAAC
    "rider": "Rider",
    "rider broncs": "Rider",

    # Robert Morris Colonials – Horizon
    "robert morris": "Robert Morris",
    "robert morris colonials": "Robert Morris",
    "rmu": "Robert Morris",

    # Rutgers Scarlet Knights – Big Ten
    "rutgers": "Rutgers",
    "rutgers scarlet knights": "Rutgers",
    "ru": "Rutgers",

    # ---- S ----

    # Sacramento State Hornets – Big Sky
    "sacramento state": "Sacramento St.",
    "sacramento st": "Sacramento St.",
    "sacramento st.": "Sacramento St.",
    "sac state": "Sacramento St.",
    "sac st": "Sacramento St.",

    # Sacred Heart Pioneers – NEC
    "sacred heart": "Sacred Heart",
    "sacred heart pioneers": "Sacred Heart",

    # Saint Francis (PA) Red Flash – NEC
    "saint francis": "Saint Francis",
    "saint francis (pa)": "Saint Francis",
    "saint francis pa": "Saint Francis",
    "st. francis": "Saint Francis",
    "st francis": "Saint Francis",
    "st. francis (pa)": "Saint Francis",
    "st. francis pa": "Saint Francis",
    "st francis (pa)": "Saint Francis",
    "st francis pa": "Saint Francis",

    # Saint Joseph's Hawks – A-10
    "saint joseph's": "Saint Joseph's",
    "saint josephs": "Saint Joseph's",
    "st. joseph's": "Saint Joseph's",
    "st joseph's": "Saint Joseph's",
    "st. josephs": "Saint Joseph's",
    "st josephs": "Saint Joseph's",

    # Saint Louis Billikens – A-10
    "saint louis": "Saint Louis",
    "saint louis billikens": "Saint Louis",
    "st. louis": "Saint Louis",
    "st louis": "Saint Louis",
    "slu": "Saint Louis",

    # Saint Mary's Gaels – WCC
    "saint mary's": "Saint Mary's",
    "saint marys": "Saint Mary's",
    "st. mary's": "Saint Mary's",
    "st mary's": "Saint Mary's",
    "st. marys": "Saint Mary's",
    "st marys": "Saint Mary's",
    "saint mary's (ca)": "Saint Mary's",
    "st mary's (ca)": "Saint Mary's",
    "smc": "Saint Mary's",

    # Saint Peter's Peacocks – MAAC
    "saint peter's": "Saint Peter's",
    "saint peters": "Saint Peter's",
    "st. peter's": "Saint Peter's",
    "st peter's": "Saint Peter's",
    "st. peters": "Saint Peter's",
    "st peters": "Saint Peter's",

    # Sam Houston Bearkats – CUSA
    "sam houston": "Sam Houston St.",
    "sam houston state": "Sam Houston St.",
    "sam houston st": "Sam Houston St.",
    "sam houston st.": "Sam Houston St.",
    "shsu": "Sam Houston St.",

    # Samford Bulldogs – SoCon
    "samford": "Samford",
    "samford bulldogs": "Samford",

    # San Diego Toreros – WCC
    "san diego": "San Diego",
    "san diego toreros": "San Diego",
    "usd": "San Diego",

    # San Diego State Aztecs – Mountain West
    "san diego state": "San Diego St.",
    "san diego st": "San Diego St.",
    "san diego st.": "San Diego St.",
    "sdsu": "San Diego St.",
    "sd state": "San Diego St.",

    # San Francisco Dons – WCC
    "san francisco": "San Francisco",
    "san francisco dons": "San Francisco",

    # San Jose State Spartans – Mountain West
    "san jose state": "San Jose St.",
    "san jose st": "San Jose St.",
    "san jose st.": "San Jose St.",
    "sjsu": "San Jose St.",

    # Santa Clara Broncos – WCC
    "santa clara": "Santa Clara",
    "santa clara broncos": "Santa Clara",
    "scu": "Santa Clara",

    # Seattle Redhawks – WAC
    "seattle": "Seattle",
    "seattle u": "Seattle",
    "seattle university": "Seattle",
    "seattle redhawks": "Seattle",

    # Seton Hall Pirates – Big East
    "seton hall": "Seton Hall",
    "seton hall pirates": "Seton Hall",

    # Siena Saints – MAAC
    "siena": "Siena",
    "siena saints": "Siena",

    # SIU Edwardsville Cougars – OVC
    "siu edwardsville": "SIU Edwardsville",
    "siue": "SIU Edwardsville",
    "southern illinois edwardsville": "SIU Edwardsville",

    # SMU Mustangs – ACC
    "smu": "SMU",
    "southern methodist": "SMU",
    "smu mustangs": "SMU",
    "southern methodist mustangs": "SMU",

    # South Alabama Jaguars – Sun Belt
    "south alabama": "South Alabama",
    "s alabama": "South Alabama",
    "usa jaguars": "South Alabama",

    # South Carolina Gamecocks – SEC
    "south carolina": "South Carolina",
    "south carolina gamecocks": "South Carolina",
    "s carolina": "South Carolina",
    "gamecocks": "South Carolina",

    # South Carolina State Bulldogs – MEAC
    "south carolina state": "South Carolina St.",
    "south carolina st": "South Carolina St.",
    "south carolina st.": "South Carolina St.",
    "sc state": "South Carolina St.",

    # South Carolina Upstate Spartans – Big South
    "south carolina upstate": "USC Upstate",
    "sc upstate": "USC Upstate",
    "usc upstate": "USC Upstate",
    "upstate": "USC Upstate",

    # South Dakota Coyotes – Summit
    "south dakota": "South Dakota",
    "south dakota coyotes": "South Dakota",
    "s dakota": "South Dakota",

    # South Dakota State Jackrabbits – Summit
    "south dakota state": "South Dakota St.",
    "south dakota st": "South Dakota St.",
    "south dakota st.": "South Dakota St.",
    "s dakota state": "South Dakota St.",

    # South Florida Bulls – AAC
    "south florida": "South Florida",
    "usf": "South Florida",
    "south florida bulls": "South Florida",
    "s florida": "South Florida",
    "usf bulls": "South Florida",

    # Southeast Missouri State Redhawks – OVC
    "southeast missouri state": "Southeast Missouri St.",
    "southeast missouri st": "Southeast Missouri St.",
    "southeast missouri st.": "Southeast Missouri St.",
    "southeast missouri": "Southeast Missouri St.",
    "se missouri state": "Southeast Missouri St.",
    "se missouri st": "Southeast Missouri St.",
    "semo": "Southeast Missouri St.",

    # Southeastern Louisiana Lions – Southland
    "southeastern louisiana": "Southeastern Louisiana",
    "se louisiana": "Southeastern Louisiana",
    "selu": "Southeastern Louisiana",

    # Southern Jaguars – SWAC
    "southern": "Southern",
    "southern university": "Southern",
    "southern jaguars": "Southern",
    "southern u": "Southern",

    # Southern Illinois Salukis – MVC
    "southern illinois": "Southern Illinois",
    "southern ill": "Southern Illinois",
    "siu": "Southern Illinois",
    "s illinois": "Southern Illinois",

    # Southern Indiana Screaming Eagles – OVC
    "southern indiana": "Southern Indiana",
    "usi": "Southern Indiana",
    "s indiana": "Southern Indiana",

    # Southern Miss Golden Eagles – Sun Belt
    "southern miss": "Southern Miss",
    "southern mississippi": "Southern Miss",
    "usm": "Southern Miss",
    "s mississippi": "Southern Miss",

    # Southern Utah Thunderbirds – WAC
    "southern utah": "Southern Utah",
    "suu": "Southern Utah",
    "s utah": "Southern Utah",

    # St. Bonaventure Bonnies – A-10
    "st. bonaventure": "St. Bonaventure",
    "st bonaventure": "St. Bonaventure",
    "saint bonaventure": "St. Bonaventure",
    "st. bonaventure bonnies": "St. Bonaventure",
    "bonnies": "St. Bonaventure",
    "bona": "St. Bonaventure",

    # St. John's Red Storm – Big East
    "st. john's": "St. John's",
    "st john's": "St. John's",
    "saint john's": "St. John's",
    "st. johns": "St. John's",
    "st johns": "St. John's",
    "saint johns": "St. John's",
    "st. john's red storm": "St. John's",

    # St. Thomas (MN) Tommies – Summit
    "st. thomas": "St. Thomas",
    "st thomas": "St. Thomas",
    "saint thomas": "St. Thomas",
    "st. thomas (mn)": "St. Thomas",
    "st thomas mn": "St. Thomas",

    # Stanford Cardinal – ACC
    "stanford": "Stanford",
    "stanford cardinal": "Stanford",

    # Stephen F. Austin Lumberjacks – Southland
    "stephen f. austin": "Stephen F. Austin",
    "stephen f austin": "Stephen F. Austin",
    "sfa": "Stephen F. Austin",
    "sf austin": "Stephen F. Austin",

    # Stetson Hatters – ASUN
    "stetson": "Stetson",
    "stetson hatters": "Stetson",

    # Stonehill Skyhawks – NEC
    "stonehill": "Stonehill",
    "stonehill skyhawks": "Stonehill",

    # Stony Brook Seawolves – CAA
    "stony brook": "Stony Brook",
    "stony brook seawolves": "Stony Brook",
    "suny stony brook": "Stony Brook",

    # Syracuse Orange – ACC
    "syracuse": "Syracuse",
    "syracuse orange": "Syracuse",
    "cuse": "Syracuse",
    "syr": "Syracuse",

    # ---- T ----

    # Tarleton State Texans – WAC
    "tarleton state": "Tarleton St.",
    "tarleton st": "Tarleton St.",
    "tarleton st.": "Tarleton St.",
    "tarleton": "Tarleton St.",

    # TCU Horned Frogs – Big 12
    "tcu": "TCU",
    "texas christian": "TCU",
    "texas christian university": "TCU",
    "tcu horned frogs": "TCU",

    # Temple Owls – AAC
    "temple": "Temple",
    "temple owls": "Temple",

    # Tennessee Volunteers – SEC
    "tennessee": "Tennessee",
    "tennessee volunteers": "Tennessee",
    "tenn": "Tennessee",
    "vols": "Tennessee",

    # Tennessee State Tigers – OVC
    "tennessee state": "Tennessee St.",
    "tennessee st": "Tennessee St.",
    "tennessee st.": "Tennessee St.",
    "tsu": "Tennessee St.",
    "tenn state": "Tennessee St.",

    # Tennessee Tech Golden Eagles – OVC
    "tennessee tech": "Tennessee Tech",
    "tenn tech": "Tennessee Tech",

    # Texas Longhorns – SEC
    "texas": "Texas",
    "texas longhorns": "Texas",
    "tex": "Texas",
    "longhorns": "Texas",

    # Texas A&M Aggies – SEC
    "texas a&m": "Texas A&M",
    "texas am": "Texas A&M",
    "texas a and m": "Texas A&M",
    "tamu": "Texas A&M",
    "texas a&m aggies": "Texas A&M",
    "a&m": "Texas A&M",
    "aggies": "Texas A&M",

    # Texas A&M-Commerce Lions – Southland
    "texas a&m-commerce": "Texas A&M Commerce",
    "texas a&m commerce": "Texas A&M Commerce",
    "tamuc": "Texas A&M Commerce",
    "a&m commerce": "Texas A&M Commerce",
    "a&m-commerce": "Texas A&M Commerce",

    # Texas A&M-Corpus Christi Islanders – Southland
    "texas a&m-corpus christi": "Texas A&M Corpus Christi",
    "texas a&m corpus christi": "Texas A&M Corpus Christi",
    "texas a&m-cc": "Texas A&M Corpus Christi",
    "tamucc": "Texas A&M Corpus Christi",
    "a&m corpus christi": "Texas A&M Corpus Christi",
    "a&m-corpus christi": "Texas A&M Corpus Christi",

    # Texas Southern Tigers – SWAC
    "texas southern": "Texas Southern",
    "texas southern tigers": "Texas Southern",
    "txso": "Texas Southern",

    # Texas State Bobcats – Sun Belt
    "texas state": "Texas St.",
    "texas st": "Texas St.",
    "texas st.": "Texas St.",
    "txst": "Texas St.",

    # Texas Tech Red Raiders – Big 12
    "texas tech": "Texas Tech",
    "texas tech red raiders": "Texas Tech",
    "ttu": "Texas Tech",
    "tex tech": "Texas Tech",

    # The Citadel Bulldogs – SoCon
    "the citadel": "The Citadel",
    "citadel": "The Citadel",
    "citadel bulldogs": "The Citadel",

    # Toledo Rockets – MAC
    "toledo": "Toledo",
    "toledo rockets": "Toledo",

    # Towson Tigers – CAA
    "towson": "Towson",
    "towson tigers": "Towson",

    # Troy Trojans – Sun Belt
    "troy": "Troy",
    "troy trojans": "Troy",

    # Tulane Green Wave – AAC
    "tulane": "Tulane",
    "tulane green wave": "Tulane",

    # Tulsa Golden Hurricane – AAC
    "tulsa": "Tulsa",
    "tulsa golden hurricane": "Tulsa",

    # ---- U ----

    # UAB Blazers – AAC
    "uab": "UAB",
    "uab blazers": "UAB",
    "alabama-birmingham": "UAB",
    "alabama birmingham": "UAB",

    # UC Davis Aggies – Big West
    "uc davis": "UC Davis",
    "uc davis aggies": "UC Davis",
    "california-davis": "UC Davis",
    "california davis": "UC Davis",
    "ucd": "UC Davis",

    # UC Irvine Anteaters – Big West
    "uc irvine": "UC Irvine",
    "uc irvine anteaters": "UC Irvine",
    "california-irvine": "UC Irvine",
    "california irvine": "UC Irvine",
    "uci": "UC Irvine",

    # UC Riverside Highlanders – Big West
    "uc riverside": "UC Riverside",
    "uc riverside highlanders": "UC Riverside",
    "california-riverside": "UC Riverside",
    "california riverside": "UC Riverside",
    "ucr": "UC Riverside",

    # UC San Diego Tritons – Big West
    "uc san diego": "UC San Diego",
    "uc san diego tritons": "UC San Diego",
    "ucsd": "UC San Diego",

    # UC Santa Barbara Gauchos – Big West
    "uc santa barbara": "UC Santa Barbara",
    "uc santa barbara gauchos": "UC Santa Barbara",
    "ucsb": "UC Santa Barbara",
    "santa barbara": "UC Santa Barbara",

    # UCLA Bruins – Big Ten
    "ucla": "UCLA",
    "ucla bruins": "UCLA",
    "bruins": "UCLA",

    # UMBC Retrievers – America East
    "umbc": "UMBC",
    "umbc retrievers": "UMBC",
    "maryland-baltimore county": "UMBC",
    "maryland baltimore county": "UMBC",

    # UMKC Kangaroos – Summit
    "umkc": "UMKC",
    "umkc kangaroos": "UMKC",
    "missouri-kansas city": "UMKC",
    "kansas city": "UMKC",

    # UNC Asheville Bulldogs – Big South
    "unc asheville": "UNC Asheville",
    "unc-asheville": "UNC Asheville",
    "north carolina-asheville": "UNC Asheville",

    # UNC Greensboro Spartans – SoCon
    "unc greensboro": "UNC Greensboro",
    "uncg": "UNC Greensboro",
    "unc-greensboro": "UNC Greensboro",
    "north carolina-greensboro": "UNC Greensboro",

    # UNC Wilmington Seahawks – CAA
    "unc wilmington": "UNC Wilmington",
    "uncw": "UNC Wilmington",
    "unc-wilmington": "UNC Wilmington",
    "north carolina-wilmington": "UNC Wilmington",

    # UNLV Rebels – Mountain West
    "unlv": "UNLV",
    "unlv rebels": "UNLV",
    "nevada-las vegas": "UNLV",
    "nevada las vegas": "UNLV",
    "las vegas": "UNLV",

    # USC Trojans – Big Ten
    "usc": "USC",
    "usc trojans": "USC",
    "southern cal": "USC",
    "southern california": "USC",
    "trojans": "USC",
    "so cal": "USC",

    # UT Arlington Mavericks – WAC
    "ut arlington": "UT Arlington",
    "texas-arlington": "UT Arlington",
    "texas arlington": "UT Arlington",
    "uta": "UT Arlington",

    # UT Martin Skyhawks – OVC
    "ut martin": "UT Martin",
    "tennessee-martin": "UT Martin",
    "tennessee martin": "UT Martin",
    "utm": "UT Martin",

    # UTRGV Vaqueros – WAC
    "ut rio grande valley": "UT Rio Grande Valley",
    "utrgv": "UT Rio Grande Valley",
    "texas rio grande valley": "UT Rio Grande Valley",
    "ut-rgv": "UT Rio Grande Valley",

    # UTEP Miners – CUSA
    "utep": "UTEP",
    "utep miners": "UTEP",
    "texas-el paso": "UTEP",
    "texas el paso": "UTEP",
    "ut el paso": "UTEP",

    # UTSA Roadrunners – AAC
    "utsa": "UTSA",
    "utsa roadrunners": "UTSA",
    "texas-san antonio": "UTSA",
    "texas san antonio": "UTSA",
    "ut san antonio": "UTSA",

    # Utah Utes – Big 12
    "utah": "Utah",
    "utah utes": "Utah",

    # Utah State Aggies – Mountain West
    "utah state": "Utah St.",
    "utah st": "Utah St.",
    "utah st.": "Utah St.",
    "usu": "Utah St.",

    # Utah Tech Trailblazers – WAC
    "utah tech": "Utah Tech",
    "dixie state": "Utah Tech",
    "utah tech trailblazers": "Utah Tech",

    # Utah Valley Wolverines – WAC
    "utah valley": "Utah Valley",
    "utah valley state": "Utah Valley",
    "uvu": "Utah Valley",

    # ---- V ----

    # Valparaiso Beacons – MVC
    "valparaiso": "Valparaiso",
    "valparaiso beacons": "Valparaiso",
    "valpo": "Valparaiso",

    # Vanderbilt Commodores – SEC
    "vanderbilt": "Vanderbilt",
    "vanderbilt commodores": "Vanderbilt",
    "vandy": "Vanderbilt",

    # VCU Rams – A-10
    "virginia commonwealth": "VCU",
    "vcu": "VCU",
    "vcu rams": "VCU",

    # Vermont Catamounts – America East
    "vermont": "Vermont",
    "vermont catamounts": "Vermont",
    "uvm": "Vermont",

    # Villanova Wildcats – Big East
    "villanova": "Villanova",
    "villanova wildcats": "Villanova",
    "nova": "Villanova",
    "'nova": "Villanova",

    # Virginia Cavaliers – ACC
    "virginia": "Virginia",
    "virginia cavaliers": "Virginia",
    "uva": "Virginia",
    "wahoos": "Virginia",
    "cavaliers": "Virginia",

    # VMI Keydets – SoCon
    "virginia military institute": "VMI",
    "vmi": "VMI",
    "vmi keydets": "VMI",

    # Virginia Tech Hokies – ACC
    "virginia tech": "Virginia Tech",
    "virginia tech hokies": "Virginia Tech",
    "vt": "Virginia Tech",
    "va tech": "Virginia Tech",
    "hokies": "Virginia Tech",

    # ---- W ----

    # Wagner Seahawks – NEC
    "wagner": "Wagner",
    "wagner seahawks": "Wagner",

    # Wake Forest Demon Deacons – ACC
    "wake forest": "Wake Forest",
    "wake forest demon deacons": "Wake Forest",
    "wake": "Wake Forest",
    "wfu": "Wake Forest",

    # Washington Huskies – Big Ten
    "washington": "Washington",
    "washington huskies": "Washington",
    "uw": "Washington",
    "udub": "Washington",
    "u dub": "Washington",

    # Washington State Cougars – Pac-12
    "washington state": "Washington St.",
    "washington st": "Washington St.",
    "washington st.": "Washington St.",
    "wsu": "Washington St.",
    "wazzu": "Washington St.",
    "wash state": "Washington St.",

    # Weber State Wildcats – Big Sky
    "weber state": "Weber St.",
    "weber st": "Weber St.",
    "weber st.": "Weber St.",
    "weber": "Weber St.",

    # West Virginia Mountaineers – Big 12
    "west virginia": "West Virginia",
    "west virginia mountaineers": "West Virginia",
    "wvu": "West Virginia",
    "w virginia": "West Virginia",

    # Western Carolina Catamounts – SoCon
    "western carolina": "Western Carolina",
    "w carolina": "Western Carolina",
    "wcu": "Western Carolina",

    # Western Illinois Leathernecks – Summit
    "western illinois": "Western Illinois",
    "w illinois": "Western Illinois",
    "wiu": "Western Illinois",

    # Western Kentucky Hilltoppers – CUSA
    "western kentucky": "Western Kentucky",
    "western ky": "Western Kentucky",
    "wku": "Western Kentucky",
    "w kentucky": "Western Kentucky",
    "western kentucky hilltoppers": "Western Kentucky",

    # Western Michigan Broncos – MAC
    "western michigan": "Western Michigan",
    "western mich": "Western Michigan",
    "wmu": "Western Michigan",
    "w michigan": "Western Michigan",

    # Wichita State Shockers – AAC
    "wichita state": "Wichita St.",
    "wichita st": "Wichita St.",
    "wichita st.": "Wichita St.",
    "wichita": "Wichita St.",
    "shockers": "Wichita St.",

    # William & Mary Tribe – CAA
    "william & mary": "William & Mary",
    "william and mary": "William & Mary",
    "w&m": "William & Mary",
    "w and m": "William & Mary",
    "william & mary tribe": "William & Mary",

    # Winthrop Eagles – Big South
    "winthrop": "Winthrop",
    "winthrop eagles": "Winthrop",

    # Wisconsin Badgers – Big Ten
    "wisconsin": "Wisconsin",
    "wisconsin badgers": "Wisconsin",
    "wisc": "Wisconsin",
    "wis": "Wisconsin",
    "badgers": "Wisconsin",

    # Wofford Terriers – SoCon
    "wofford": "Wofford",
    "wofford terriers": "Wofford",

    # Wright State Raiders – Horizon
    "wright state": "Wright St.",
    "wright st": "Wright St.",
    "wright st.": "Wright St.",
    "wright": "Wright St.",

    # Wyoming Cowboys – Mountain West
    "wyoming": "Wyoming",
    "wyoming cowboys": "Wyoming",
    "wyo": "Wyoming",

    # ---- X ----

    # Xavier Musketeers – Big East
    "xavier": "Xavier",
    "xavier musketeers": "Xavier",

    # ---- Y ----

    # Yale Bulldogs – Ivy
    "yale": "Yale",
    "yale bulldogs": "Yale",

    # Youngstown State Penguins – Horizon
    "youngstown state": "Youngstown St.",
    "youngstown st": "Youngstown St.",
    "youngstown st.": "Youngstown St.",
    "ysu": "Youngstown St.",
    "youngstown": "Youngstown St.",
}

# ---------------------------------------------------------------------------
# Pre-computed lookup tables (built once at import time)
# ---------------------------------------------------------------------------

# Fast lowercase key -> canonical value lookup.
_LOOKUP: dict[str, str] = {k.lower().strip(): v for k, v in TEAM_ALIASES.items()}

# Set of all canonical values for the "already canonical?" check.
_CANONICAL_VALUES: frozenset[str] = frozenset(TEAM_ALIASES.values())

# Sorted list of canonical names for default fuzzy_match candidates.
_CANONICAL_SORTED: list[str] = sorted(_CANONICAL_VALUES)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_WS_RE = re.compile(r"\s+")


def _normalize_key(name: str) -> str:
    """Produce a stable lookup key from a raw team name string."""
    return _WS_RE.sub(" ", name.strip()).lower()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


@lru_cache(maxsize=2048)
def canonicalize(name: str) -> str:
    """Return the canonical team name for *name*.

    Resolution order:

    1. Strip leading/trailing whitespace and collapse internal runs of
       whitespace to a single space.
    2. Exact match against ``TEAM_ALIASES`` (keys are already lower-case).
    3. Case-insensitive match (input folded to lower-case).
    4. Try with / without trailing period to handle "St." vs "St"
       mismatches.
    5. If the cleaned input is already a canonical *value* in the table,
       return it as-is.
    6. Fall back to the title-cased, whitespace-normalised input so that
       downstream code always gets something presentable.

    Parameters
    ----------
    name : str
        Raw team name from any data source (odds feed, box score, CSV, etc.).

    Returns
    -------
    str
        Canonical team name.
    """
    if not name or not name.strip():
        logger.warning("canonicalize called with empty name")
        return name

    # Step 1 -- normalise whitespace
    cleaned = _WS_RE.sub(" ", name.strip())

    # Step 2 -- exact (case-preserved) key lookup
    if cleaned in _LOOKUP:
        return _LOOKUP[cleaned]

    # Step 3 -- case-insensitive
    folded = cleaned.lower()
    if folded in _LOOKUP:
        return _LOOKUP[folded]

    # Step 4 -- trailing-period tolerance
    folded_no_dot = folded.rstrip(".")
    if folded_no_dot in _LOOKUP:
        return _LOOKUP[folded_no_dot]
    folded_with_dot = folded + "."
    if folded_with_dot in _LOOKUP:
        return _LOOKUP[folded_with_dot]

    # Step 5 -- already canonical?
    if cleaned in _CANONICAL_VALUES:
        return cleaned

    # Step 6 -- fallback to title-cased cleaned input
    fallback = cleaned.title()
    logger.debug("No canonical alias for %r; returning %r", name, fallback)
    return fallback


def fuzzy_match(
    name: str,
    candidates: list[str] | None = None,
    threshold: float = 0.80,
) -> Optional[str]:
    """Return the best fuzzy match for *name* among *candidates*.

    Uses :class:`difflib.SequenceMatcher` (ratio) to score each candidate.
    If no candidate meets the *threshold* the function returns ``None``.

    When *candidates* is ``None`` or empty the set of canonical team names
    (i.e. the unique values of ``TEAM_ALIASES``) is used automatically.

    Parameters
    ----------
    name : str
        The raw / unrecognised team name to look up.
    candidates : list[str] or None
        An explicit list of candidate strings to score against.  Defaults
        to all canonical names from ``TEAM_ALIASES``.
    threshold : float
        Minimum ``SequenceMatcher.ratio()`` required (0.0 -- 1.0).

    Returns
    -------
    str or None
        Best matching candidate, or ``None`` if nothing meets the threshold.
    """
    if not name:
        return None

    cleaned = _normalize_key(name)

    if candidates is None or len(candidates) == 0:
        candidates = _CANONICAL_SORTED

    best_score: float = 0.0
    best_match: Optional[str] = None

    for candidate in candidates:
        score = difflib.SequenceMatcher(
            None,
            cleaned,
            candidate.lower(),
        ).ratio()
        if score > best_score:
            best_score = score
            best_match = candidate

    if best_score >= threshold:
        return best_match
    return None
