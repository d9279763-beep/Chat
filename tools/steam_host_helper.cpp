#include <algorithm>
#include <chrono>
#include <iostream>
#include <map>
#include <random>
#include <sstream>
#include <string>
#include <vector>

namespace {

std::vector<std::string> splitCommaSeparated(const std::string& input) {
    std::vector<std::string> items;
    std::stringstream ss(input);
    std::string item;

    while (std::getline(ss, item, ',')) {
        const auto start = item.find_first_not_of(" \t");
        const auto end = item.find_last_not_of(" \t");
        if (start == std::string::npos || end == std::string::npos) {
            continue;
        }
        items.push_back(item.substr(start, end - start + 1));
    }
    return items;
}

bool hasDuplicates(const std::vector<std::string>& values) {
    std::vector<std::string> copy = values;
    std::sort(copy.begin(), copy.end());
    return std::adjacent_find(copy.begin(), copy.end()) != copy.end();
}

std::string randomSeedString() {
    const auto now = std::chrono::high_resolution_clock::now().time_since_epoch().count();
    std::mt19937_64 rng(static_cast<std::uint64_t>(now));
    std::uniform_int_distribution<unsigned long long> dist;
    std::ostringstream out;
    out << std::hex << dist(rng);
    return out.str();
}

void printUsage(const char* binaryName) {
    std::cout << "Usage:\n  " << binaryName
              << " --players \"name1,name2,name3,name4\" [--impostors 1] [--jester]"
              << " [--extra \"Sheriff:1,Engineer:1\"] [--seed custom-seed]\n\n";
    std::cout << "Example:\n  " << binaryName
              << " --players \"Alex,Blair,Casey,Drew,Emery,Flynn\" --impostors 2 --jester"
              << " --extra \"Sheriff:1,Engineer:1\"\n";
}

}  // namespace

int main(int argc, char** argv) {
    std::string playersArg;
    std::string extrasArg;
    std::string seed = randomSeedString();
    int impostorCount = 1;
    bool includeJester = false;

    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--players" && i + 1 < argc) {
            playersArg = argv[++i];
        } else if (arg == "--impostors" && i + 1 < argc) {
            impostorCount = std::stoi(argv[++i]);
        } else if (arg == "--jester") {
            includeJester = true;
        } else if (arg == "--extra" && i + 1 < argc) {
            extrasArg = argv[++i];
        } else if (arg == "--seed" && i + 1 < argc) {
            seed = argv[++i];
        } else if (arg == "--help" || arg == "-h") {
            printUsage(argv[0]);
            return 0;
        } else {
            std::cerr << "Unknown argument: " << arg << "\n";
            printUsage(argv[0]);
            return 1;
        }
    }

    const std::vector<std::string> players = splitCommaSeparated(playersArg);
    if (players.size() < 4) {
        std::cerr << "Error: at least 4 players are required.\n";
        return 1;
    }
    if (hasDuplicates(players)) {
        std::cerr << "Error: player names must be unique.\n";
        return 1;
    }
    if (impostorCount < 1 || impostorCount > 3) {
        std::cerr << "Error: impostor count must be between 1 and 3.\n";
        return 1;
    }

    std::vector<std::string> rolePool(impostorCount, "Impostor");
    if (includeJester) {
        rolePool.emplace_back("Jester");
    }

    const std::vector<std::string> extraItems = splitCommaSeparated(extrasArg);
    for (const auto& extra : extraItems) {
        const auto sep = extra.find(':');
        if (sep == std::string::npos) {
            std::cerr << "Error: invalid extra role format '" << extra
                      << "'. Expected Role:Count.\n";
            return 1;
        }
        const std::string role = extra.substr(0, sep);
        const int count = std::stoi(extra.substr(sep + 1));
        if (count < 0) {
            std::cerr << "Error: role count cannot be negative.\n";
            return 1;
        }
        for (int i = 0; i < count; ++i) {
            rolePool.push_back(role);
        }
    }

    if (rolePool.size() > players.size()) {
        std::cerr << "Error: role count exceeds player count.\n";
        return 1;
    }

    rolePool.insert(rolePool.end(), players.size() - rolePool.size(), "Crewmate");

    std::seed_seq seq(seed.begin(), seed.end());
    std::mt19937 rng(seq);
    std::vector<std::string> shuffledPlayers = players;
    std::shuffle(shuffledPlayers.begin(), shuffledPlayers.end(), rng);
    std::shuffle(rolePool.begin(), rolePool.end(), rng);

    std::map<std::string, int> roleCounts;
    std::cout << "Seed: " << seed << "\n";
    std::cout << "\nAssignments:\n";
    for (std::size_t i = 0; i < shuffledPlayers.size(); ++i) {
        std::cout << "  - " << shuffledPlayers[i] << ": " << rolePool[i] << "\n";
        roleCounts[rolePool[i]]++;
    }

    std::cout << "\nRole Counts:\n";
    for (const auto& [role, count] : roleCounts) {
        std::cout << "  - " << role << ": " << count << "\n";
    }

    std::cout
        << "\nNote: this is a host-side companion utility and does not patch or inject into Steam binaries.\n";
    return 0;
}
