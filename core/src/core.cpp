#include "cpulab/core.hpp"

#include <algorithm>
#include <bitset>
#include <charconv>
#include <cctype>
#include <cstring>
#include <iomanip>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>

namespace cpulab {
namespace {

int32_t signExtend(uint32_t v, unsigned bits) {
  const uint32_t mask = 1u << (bits - 1u);
  return static_cast<int32_t>((v ^ mask) - mask);
}

std::string upper(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c){ return static_cast<char>(std::toupper(c)); });
  return s;
}

std::string trim(const std::string& s) {
  const auto first = s.find_first_not_of(" \t\r\n");
  if (first == std::string::npos) return {};
  return s.substr(first, s.find_last_not_of(" \t\r\n") - first + 1);
}

std::string stripComment(const std::string& s) {
  auto p = s.find('#');
  auto q = s.find("//");
  auto end = std::min(p == std::string::npos ? s.size() : p, q == std::string::npos ? s.size() : q);
  return s.substr(0, end);
}

std::vector<std::string> tokens(std::string s) {
  for (char& c : s) if (c == ',' || c == '(' || c == ')') c = ' ';
  std::istringstream in(s);
  std::vector<std::string> out;
  for (std::string t; in >> t;) out.push_back(t);
  return out;
}

bool parseInteger(const std::string& token, int64_t& result) {
  try {
    size_t used = 0;
    int base = 10;
    std::string s = token;
    bool neg = !s.empty() && s[0] == '-';
    size_t prefix = neg ? 1 : 0;
    if (s.size() > prefix + 2 && s[prefix] == '0' && (s[prefix+1] == 'x' || s[prefix+1] == 'X')) base = 16;
    result = std::stoll(s, &used, base);
    return used == s.size();
  } catch (...) { return false; }
}

bool parseReg(const std::string& t, uint8_t& r) {
  if (t.size() < 2 || (t[0] != 'r' && t[0] != 'R')) return false;
  int64_t n = 0;
  if (!parseInteger(t.substr(1), n) || n < 0 || n > 31) return false;
  r = static_cast<uint8_t>(n); return true;
}

std::string jsonEscape(const std::string& s) {
  std::ostringstream out;
  for (unsigned char c : s) {
    switch (c) {
      case '"': out << "\\\""; break; case '\\': out << "\\\\"; break;
      case '\n': out << "\\n"; break; case '\r': out << "\\r"; break; case '\t': out << "\\t"; break;
      default: if (c < 32) out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << int(c) << std::dec; else out << c;
    }
  }
  return out.str();
}

std::string eventsJson(const std::vector<Event>& events) {
  std::ostringstream out;out<<'[';
  for(size_t i=0;i<events.size();++i){if(i)out<<',';const auto&e=events[i];out<<"{\"type\":\""<<e.type<<"\",\"cycle\":"<<e.cycle<<",\"stage\":\""<<e.stage<<"\",\"instructionIds\":[";for(size_t k=0;k<e.instructionIds.size();++k){if(k)out<<',';out<<e.instructionIds[k];}out<<"],\"reg\":"<<e.reg<<",\"source\":\""<<e.source<<"\",\"message\":\""<<jsonEscape(e.message)<<"\",\"watchpointKind\":\""<<e.watchpointKind<<"\",\"access\":\""<<e.access<<"\",\"address\":";if(e.address<0)out<<"null";else out<<e.address;out<<",\"oldValue\":"<<e.oldValue<<",\"newValue\":"<<e.newValue<<'}';}
  out<<']';return out.str();
}

uint32_t readLE(const std::vector<uint8_t>& mem, uint32_t a) {
  return uint32_t(mem[a]) | (uint32_t(mem[a+1]) << 8) | (uint32_t(mem[a+2]) << 16) | (uint32_t(mem[a+3]) << 24);
}

void writeLE(std::vector<uint8_t>& mem, uint32_t a, uint32_t v) {
  if (uint64_t(a) + 4 > mem.size()) return;
  mem[a] = uint8_t(v); mem[a+1] = uint8_t(v >> 8); mem[a+2] = uint8_t(v >> 16); mem[a+3] = uint8_t(v >> 24);
}

bool writes(const PipelineSlot& s, uint8_t reg) { return s.valid && s.decoded.writesRd && s.decoded.rd == reg && reg != 0; }

std::string forwardingName(ForwardingMode m) {
  return m == ForwardingMode::Full ? "full" : m == ForwardingMode::None ? "none" : "manual";
}
std::string predictorName(PredictorMode m) {
  switch (m) { case PredictorMode::AlwaysNotTaken: return "always-not-taken"; case PredictorMode::AlwaysTaken: return "always-taken"; case PredictorMode::OneBit: return "one-bit"; default: return "two-bit"; }
}

struct ConfigurationParseResult {
  Configuration configuration{};
  std::vector<std::string> errors;
};

struct JsonFieldToken { std::string value; bool quoted{false}; };

void validateConfigurationObjectShape(const std::string& json, std::vector<std::string>& errors) {
  static const std::set<std::string> allowed = {"forwarding", "predictor", "predictorEntries", "cacheEnabled", "cacheCapacity", "cacheBlockSize", "cacheAssociativity", "cacheHitLatency", "cacheMissPenalty"};
  size_t position = 1;
  const auto skipWhitespace = [&]() { while (position < json.size() && std::isspace(static_cast<unsigned char>(json[position]))) ++position; };
  while (position + 1 < json.size()) {
    skipWhitespace();
    if (position + 1 == json.size()) return;
    if (json[position] != '"') { errors.push_back("Processor configuration contains malformed JSON."); return; }
    const auto keyEnd = json.find('"', position + 1);
    if (keyEnd == std::string::npos) { errors.push_back("Processor configuration contains an unterminated field name."); return; }
    const auto key = json.substr(position + 1, keyEnd - position - 1);
    if (!allowed.count(key)) errors.push_back("Unknown processor configuration field '" + key + "'.");
    position = keyEnd + 1; skipWhitespace();
    if (position >= json.size() || json[position] != ':') { errors.push_back("Configuration field '" + key + "' has no value separator."); return; }
    ++position; skipWhitespace();
    if (position >= json.size()) { errors.push_back("Configuration field '" + key + "' has no value."); return; }
    if (json[position] == '"') {
      const auto valueEnd = json.find('"', position + 1);
      if (valueEnd == std::string::npos) { errors.push_back("Configuration field '" + key + "' contains an unterminated string."); return; }
      position = valueEnd + 1;
    } else {
      const auto valueEnd = json.find_first_of(",}", position);
      if (trim(json.substr(position, valueEnd == std::string::npos ? std::string::npos : valueEnd - position)).empty()) { errors.push_back("Configuration field '" + key + "' has no value."); return; }
      position = valueEnd == std::string::npos ? json.size() : valueEnd;
    }
    skipWhitespace();
    if (position + 1 == json.size() && json[position] == '}') return;
    if (position >= json.size() || json[position] != ',') { errors.push_back("Processor configuration contains malformed JSON after field '" + key + "'."); return; }
    ++position; skipWhitespace();
    if (position >= json.size() || json[position] != '"') { errors.push_back("Processor configuration contains a trailing comma or malformed field."); return; }
  }
}

std::optional<JsonFieldToken> jsonField(const std::string& json, const std::string& key, std::vector<std::string>& errors) {
  const std::string needle = "\"" + key + "\"";
  const auto keyPosition = json.find(needle);
  if (keyPosition == std::string::npos) return std::nullopt;
  if (json.find(needle, keyPosition + needle.size()) != std::string::npos) {
    errors.push_back("Configuration field '" + key + "' appears more than once.");
    return std::nullopt;
  }
  auto position = json.find(':', keyPosition + needle.size());
  if (position == std::string::npos) {
    errors.push_back("Configuration field '" + key + "' has no value.");
    return std::nullopt;
  }
  ++position;
  while (position < json.size() && std::isspace(static_cast<unsigned char>(json[position]))) ++position;
  if (position >= json.size()) {
    errors.push_back("Configuration field '" + key + "' has no value.");
    return std::nullopt;
  }
  if (json[position] == '"') {
    const auto end = json.find('"', position + 1);
    if (end == std::string::npos) {
      errors.push_back("Configuration field '" + key + "' contains an unterminated string.");
      return std::nullopt;
    }
    return JsonFieldToken{json.substr(position + 1, end - position - 1), true};
  }
  const auto end = json.find_first_of(",}", position);
  return JsonFieldToken{trim(json.substr(position, end == std::string::npos ? std::string::npos : end - position)), false};
}

bool parseUnsignedField(const std::string& json, const std::string& key, uint32_t& value, std::vector<std::string>& errors) {
  const auto field = jsonField(json, key, errors);
  if (!field) return true;
  uint64_t parsed = 0;
  const auto conversion = std::from_chars(field->value.data(), field->value.data() + field->value.size(), parsed);
  if (field->quoted || field->value.empty() || conversion.ec != std::errc{} || conversion.ptr != field->value.data() + field->value.size() || parsed > std::numeric_limits<uint32_t>::max()) {
    errors.push_back("Configuration field '" + key + "' must be an unsigned integer.");
    return false;
  }
  value = static_cast<uint32_t>(parsed);
  return true;
}

bool isPowerOfTwo(uint32_t value) { return value != 0 && (value & (value - 1)) == 0; }

ConfigurationParseResult parseConfiguration(const std::string& json) {
  ConfigurationParseResult result;
  const auto cleaned = trim(json);
  if (cleaned.size() < 2 || cleaned.front() != '{' || cleaned.back() != '}') {
    result.errors.push_back("Processor configuration must be a JSON object.");
    return result;
  }
  validateConfigurationObjectShape(cleaned, result.errors);

  if (const auto field = jsonField(cleaned, "forwarding", result.errors)) {
    if (!field->quoted) result.errors.push_back("Configuration field 'forwarding' must be a string.");
    else if (field->value == "full") result.configuration.forwarding = ForwardingMode::Full;
    else if (field->value == "none") result.configuration.forwarding = ForwardingMode::None;
    else if (field->value == "manual") result.configuration.forwarding = ForwardingMode::Manual;
    else result.errors.push_back("Hazard handling must be 'full', 'none', or 'manual'.");
  }
  if (const auto field = jsonField(cleaned, "predictor", result.errors)) {
    if (!field->quoted) result.errors.push_back("Configuration field 'predictor' must be a string.");
    else if (field->value == "always-not-taken") result.configuration.predictor = PredictorMode::AlwaysNotTaken;
    else if (field->value == "always-taken") result.configuration.predictor = PredictorMode::AlwaysTaken;
    else if (field->value == "one-bit") result.configuration.predictor = PredictorMode::OneBit;
    else if (field->value == "two-bit") result.configuration.predictor = PredictorMode::TwoBit;
    else result.errors.push_back("Branch predictor mode is not recognized.");
  }
  if (const auto field = jsonField(cleaned, "cacheEnabled", result.errors)) {
    if (!field->quoted && field->value == "true") result.configuration.cacheEnabled = true;
    else if (!field->quoted && field->value == "false") result.configuration.cacheEnabled = false;
    else result.errors.push_back("Configuration field 'cacheEnabled' must be boolean.");
  }
  parseUnsignedField(cleaned, "predictorEntries", result.configuration.predictorEntries, result.errors);
  parseUnsignedField(cleaned, "cacheCapacity", result.configuration.cacheCapacity, result.errors);
  parseUnsignedField(cleaned, "cacheBlockSize", result.configuration.cacheBlockSize, result.errors);
  parseUnsignedField(cleaned, "cacheAssociativity", result.configuration.cacheAssociativity, result.errors);
  parseUnsignedField(cleaned, "cacheHitLatency", result.configuration.cacheHitLatency, result.errors);
  parseUnsignedField(cleaned, "cacheMissPenalty", result.configuration.cacheMissPenalty, result.errors);

  if (!isPowerOfTwo(result.configuration.predictorEntries) || result.configuration.predictorEntries > 1024) result.errors.push_back("Predictor entries must be a power of two from 1 to 1024.");
  if (!isPowerOfTwo(result.configuration.cacheCapacity) || result.configuration.cacheCapacity < 16 || result.configuration.cacheCapacity > 65536) result.errors.push_back("Cache capacity must be a power of two from 16 to 65536 bytes.");
  if (!isPowerOfTwo(result.configuration.cacheBlockSize) || result.configuration.cacheBlockSize < 4 || result.configuration.cacheBlockSize > 256) result.errors.push_back("Cache block size must be a power of two from 4 to 256 bytes.");
  if (!isPowerOfTwo(result.configuration.cacheAssociativity) || result.configuration.cacheAssociativity > 16) result.errors.push_back("Cache associativity must be a power of two from 1 to 16 ways.");
  const uint64_t wayBytes = uint64_t(result.configuration.cacheBlockSize) * result.configuration.cacheAssociativity;
  if (wayBytes > result.configuration.cacheCapacity || result.configuration.cacheCapacity % wayBytes != 0) result.errors.push_back("Cache capacity must contain a whole number of sets for the selected block size and associativity.");
  if (result.configuration.cacheHitLatency < 1 || result.configuration.cacheHitLatency > 20) result.errors.push_back("Cache hit latency must be from 1 to 20 cycles.");
  if (result.configuration.cacheMissPenalty < 1 || result.configuration.cacheMissPenalty > 1000) result.errors.push_back("Cache miss penalty must be from 1 to 1000 cycles.");
  return result;
}

std::string configurationJson(const Configuration& configuration) {
  std::ostringstream out;
  out << "{\"forwarding\":\"" << forwardingName(configuration.forwarding)
      << "\",\"predictor\":\"" << predictorName(configuration.predictor)
      << "\",\"predictorEntries\":" << configuration.predictorEntries
      << ",\"cacheEnabled\":" << (configuration.cacheEnabled ? "true" : "false")
      << ",\"cacheCapacity\":" << configuration.cacheCapacity
      << ",\"cacheBlockSize\":" << configuration.cacheBlockSize
      << ",\"cacheAssociativity\":" << configuration.cacheAssociativity
      << ",\"cacheHitLatency\":" << configuration.cacheHitLatency
      << ",\"cacheMissPenalty\":" << configuration.cacheMissPenalty << '}';
  return out.str();
}

std::string configurationResultJson(const ConfigurationParseResult& result) {
  std::ostringstream out;
  out << "{\"ok\":" << (result.errors.empty() ? "true" : "false") << ",\"configuration\":" << configurationJson(result.configuration) << ",\"errors\":[";
  for (size_t index = 0; index < result.errors.size(); ++index) {
    if (index) out << ',';
    out << "\"" << jsonEscape(result.errors[index]) << "\"";
  }
  out << "]}";
  return out.str();
}

}  // namespace

std::string opName(Op op) {
  static const char* names[] = {"NOP","ADD","SUB","MUL","ADDI","AND","OR","XOR","SLL","SRL","SLT","LW","SW","BEQ","BNE","BLT","J","JAL","JR","LUI","HALT"};
  const auto v = static_cast<unsigned>(op);
  return v <= static_cast<unsigned>(Op::HALT) ? names[v] : "INVALID";
}

uint32_t encodeR(Op op, uint8_t rd, uint8_t rs1, uint8_t rs2) {
  return (uint32_t(op) << 26) | (uint32_t(rd) << 21) | (uint32_t(rs1) << 16) | (uint32_t(rs2) << 11);
}
uint32_t encodeI(Op op, uint8_t rd, uint8_t rs1, int32_t imm) {
  return (uint32_t(op) << 26) | (uint32_t(rd) << 21) | (uint32_t(rs1) << 16) | (uint32_t(imm) & 0xffffu);
}
uint32_t encodeB(Op op, uint8_t rs1, uint8_t rs2, int32_t off) {
  return (uint32_t(op) << 26) | (uint32_t(rs1) << 21) | (uint32_t(rs2) << 16) | (uint32_t(off) & 0xffffu);
}
uint32_t encodeJ(Op op, uint8_t rd, int32_t off) {
  return (uint32_t(op) << 26) | (uint32_t(rd) << 21) | (uint32_t(off) & 0x1fffffu);
}

Decoded decode(uint32_t word) {
  Decoded d; d.op = static_cast<Op>((word >> 26) & 0x3f);
  d.rd = uint8_t((word >> 21) & 31); d.rs1 = uint8_t((word >> 16) & 31); d.rs2 = uint8_t((word >> 11) & 31);
  switch (d.op) {
    case Op::ADD: case Op::SUB: case Op::MUL: case Op::AND: case Op::OR: case Op::XOR: case Op::SLL: case Op::SRL: case Op::SLT:
      d.usesRs1 = d.usesRs2 = d.writesRd = true; break;
    case Op::ADDI: d.imm = signExtend(word & 0xffff,16); d.usesRs1 = d.writesRd = true; break;
    case Op::LW: d.imm = signExtend(word & 0xffff,16); d.usesRs1 = d.writesRd = d.isLoad = true; break;
    case Op::SW: d.rs2 = d.rd; d.rd = 0; d.imm = signExtend(word & 0xffff,16); d.usesRs1 = d.usesRs2 = d.isStore = true; break;
    case Op::BEQ: case Op::BNE: case Op::BLT:
      d.rs1 = uint8_t((word >> 21) & 31); d.rs2 = uint8_t((word >> 16) & 31); d.rd = 0; d.imm = signExtend(word & 0xffff,16) * 4; d.usesRs1 = d.usesRs2 = d.isBranch = true; break;
    case Op::J: d.rd = 0; d.imm = signExtend(word & 0x1fffff,21) * 4; d.isJump = true; break;
    case Op::JAL: d.imm = signExtend(word & 0x1fffff,21) * 4; d.isJump = d.writesRd = true; break;
    case Op::JR: d.rs1 = uint8_t((word >> 21) & 31); d.rd = 0; d.usesRs1 = d.isJump = true; break;
    case Op::LUI: d.imm = int32_t((word & 0xffff) << 16); d.writesRd = true; break;
    case Op::NOP: case Op::HALT: break;
    default: d.op = Op::INVALID; break;
  }
  return d;
}

Program Assembler::assemble(const std::string& source) const {
  Program p;
  struct Line { int number; std::string text; std::vector<std::string> tok; uint32_t pc; };
  std::vector<Line> lines;
  std::istringstream input(source);
  std::string raw; int lineNo = 0; uint32_t pc = 0;
  while (std::getline(input, raw)) {
    ++lineNo; std::string clean = trim(stripComment(raw));
    if (clean.empty()) continue;
    auto colon = clean.find(':');
    if (colon != std::string::npos) {
      std::string label = trim(clean.substr(0,colon));
      if (label.empty() || !(std::isalpha(static_cast<unsigned char>(label[0])) || label[0] == '_') ||
          !std::all_of(label.begin()+1,label.end(),[](unsigned char c){return std::isalnum(c)||c=='_';})) {
        p.errors.push_back({lineNo,1,"Invalid label name"});
      } else if (p.labels.count(label)) p.errors.push_back({lineNo,1,"Duplicate label '"+label+"'"});
      else p.labels[label] = pc;
      clean = trim(clean.substr(colon+1));
      if (clean.empty()) continue;
    }
    auto tok = tokens(clean);
    uint32_t count = 1;
    if (!tok.empty() && upper(tok[0]) == "LI" && tok.size() == 3) {
      int64_t v=0; if (parseInteger(tok[2],v) && (v < -32768 || v > 32767)) count=2;
    }
    lines.push_back({lineNo,clean,tok,pc}); pc += count*4;
  }

  auto err = [&](int line, const std::string& msg){ p.errors.push_back({line,1,msg}); };
  auto imm = [&](const std::string& t, int line, int64_t lo, int64_t hi, int64_t& v)->bool {
    if (!parseInteger(t,v)) { err(line,"Invalid integer literal '"+t+"'"); return false; }
    if (v<lo||v>hi) { err(line,"Immediate "+t+" is outside ["+std::to_string(lo)+", "+std::to_string(hi)+"]"); return false; } return true;
  };
  auto target = [&](const std::string& t,int line,uint32_t at,unsigned bits,int32_t& off)->bool {
    auto it=p.labels.find(t); int64_t addr=0;
    if(it!=p.labels.end()) addr=it->second; else if(!parseInteger(t,addr)){err(line,"Unknown label '"+t+"'");return false;}
    if((addr&3)!=0){err(line,"Branch target must be 4-byte aligned");return false;}
    int64_t words=(addr-int64_t(at+4))/4; int64_t lo=-(int64_t(1)<<(bits-1)), hi=(int64_t(1)<<(bits-1))-1;
    if(words<lo||words>hi){err(line,"Control-flow target is out of range");return false;} off=int32_t(words);return true;
  };
  auto emit = [&](uint32_t w,const std::string& text,int line){p.words.push_back(w);p.assembly.push_back(text);p.sourceLines.push_back(line);};

  for (const auto& ln : lines) {
    auto t=ln.tok; if(t.empty()) continue; std::string op=upper(t[0]); uint8_t a=0,b=0,c=0; int64_t v=0; int32_t off=0;
    auto count=[&](size_t n)->bool{if(t.size()!=n){err(ln.number,op+" expects "+std::to_string(n-1)+" operand(s), got "+std::to_string(t.size()-1));return false;}return true;};
    auto reg=[&](size_t i,uint8_t& r)->bool{if(!parseReg(t[i],r)){err(ln.number,"Invalid register '"+t[i]+"'; expected r0 through r31");return false;}return true;};
    auto r3=[&](){return count(4)&&reg(1,a)&&reg(2,b)&&reg(3,c);};
    auto rri=[&](){return count(4)&&reg(1,a)&&reg(2,b)&&imm(t[3],ln.number,-32768,32767,v);};
    if(op=="LI") { if(!count(3)||!reg(1,a)||!imm(t[2],ln.number,std::numeric_limits<int32_t>::min(),std::numeric_limits<uint32_t>::max(),v)) continue; uint32_t u=uint32_t(v); if(int64_t(int32_t(u))>=-32768&&int64_t(int32_t(u))<=32767) emit(encodeI(Op::ADDI,a,0,int16_t(u)),"ADDI r"+std::to_string(a)+", r0, "+std::to_string(int16_t(u)),ln.number); else { uint32_t hi=(u+0x8000u)>>16; int16_t lo=int16_t(u); emit(encodeI(Op::LUI,a,0,int32_t(hi&0xffff)),"LUI r"+std::to_string(a)+", "+std::to_string(hi&0xffff),ln.number); emit(encodeI(Op::ADDI,a,a,lo),"ADDI r"+std::to_string(a)+", r"+std::to_string(a)+", "+std::to_string(lo),ln.number);} continue; }
    if(op=="MOV") { if(count(3)&&reg(1,a)&&reg(2,b)) emit(encodeI(Op::ADDI,a,b,0),ln.text,ln.number); continue; }
    if(op=="B") op="J";
    if(op=="RET") { if(count(1)) emit(encodeJ(Op::JR,31,0),ln.text,ln.number); continue; }
    if(op=="NOP") { if(count(1)) emit(encodeR(Op::NOP,0,0,0),ln.text,ln.number); }
    else if(op=="HALT") { if(count(1)) emit(encodeR(Op::HALT,0,0,0),ln.text,ln.number); }
    else if(op=="ADD"||op=="SUB"||op=="MUL"||op=="AND"||op=="OR"||op=="XOR"||op=="SLL"||op=="SRL"||op=="SLT") { if(r3()){ static const std::map<std::string,Op> m={{"ADD",Op::ADD},{"SUB",Op::SUB},{"MUL",Op::MUL},{"AND",Op::AND},{"OR",Op::OR},{"XOR",Op::XOR},{"SLL",Op::SLL},{"SRL",Op::SRL},{"SLT",Op::SLT}};emit(encodeR(m.at(op),a,b,c),ln.text,ln.number);} }
    else if(op=="ADDI") { if(rri()) emit(encodeI(Op::ADDI,a,b,int32_t(v)),ln.text,ln.number); }
    else if(op=="LUI") { if(count(3)&&reg(1,a)&&imm(t[2],ln.number,-32768,65535,v)) emit(encodeI(Op::LUI,a,0,int32_t(v)),ln.text,ln.number); }
    else if(op=="LW") { if(count(4)&&reg(1,a)&&imm(t[2],ln.number,-32768,32767,v)&&reg(3,b)) emit(encodeI(Op::LW,a,b,int32_t(v)),ln.text,ln.number); }
    else if(op=="SW") { if(count(4)&&reg(1,a)&&imm(t[2],ln.number,-32768,32767,v)&&reg(3,b)) emit(encodeI(Op::SW,a,b,int32_t(v)),ln.text,ln.number); }
    else if(op=="BEQ"||op=="BNE"||op=="BLT") { if(count(4)&&reg(1,a)&&reg(2,b)&&target(t[3],ln.number,ln.pc,16,off)){Op x=op=="BEQ"?Op::BEQ:op=="BNE"?Op::BNE:Op::BLT;emit(encodeB(x,a,b,off),ln.text,ln.number);} }
    else if(op=="J") { if(count(2)&&target(t[1],ln.number,ln.pc,21,off)) emit(encodeJ(Op::J,0,off),ln.text,ln.number); }
    else if(op=="JAL") { if(count(3)&&reg(1,a)&&target(t[2],ln.number,ln.pc,21,off)) emit(encodeJ(Op::JAL,a,off),ln.text,ln.number); }
    else if(op=="JR") { if(count(2)&&reg(1,a)) emit(encodeJ(Op::JR,a,0),ln.text,ln.number); }
    else err(ln.number,"Unknown instruction '"+t[0]+"'");
  }
  if (uint64_t(p.words.size()) * 4 > Configuration{}.memoryBytes) p.errors.push_back({p.sourceLines.empty()?1:p.sourceLines.back(),1,"Program image exceeds the 64 KiB instruction-memory capacity."});
  return p;
}

void BranchPredictor::reset(PredictorMode mode, uint32_t entries) { mode_=mode; table_.assign(std::max(1u,entries),{}); }
bool BranchPredictor::predict(uint32_t pc) const {
  if(mode_==PredictorMode::AlwaysNotTaken) return false; if(mode_==PredictorMode::AlwaysTaken) return true;
  const auto& e=table_[(pc/4)%table_.size()]; if(!e.valid||e.tagPc!=pc) return false;
  return mode_==PredictorMode::OneBit ? e.state!=0 : e.state>=2;
}
uint8_t BranchPredictor::state(uint32_t pc) const { const auto&e=table_[(pc/4)%table_.size()];return e.valid&&e.tagPc==pc?e.state:mode_==PredictorMode::TwoBit?1:0; }
std::pair<uint8_t,uint8_t> BranchPredictor::update(uint32_t pc,bool taken) {
  auto& e=table_[(pc/4)%table_.size()]; uint8_t before=state(pc); e.valid=true;e.tagPc=pc;e.recentTaken=taken;
  if(mode_==PredictorMode::OneBit)e.state=uint8_t(taken?1:0); else if(mode_==PredictorMode::TwoBit)e.state=uint8_t(taken?std::min<int>(3,before+1):std::max<int>(0,before-1)); else e.state=uint8_t(taken?3:0);
  return {before,e.state};
}

void DataCache::reset(const Configuration& cfg) {
  cfg_=cfg;stats_={};tick_=0; uint32_t ways=std::max(1u,cfg.cacheAssociativity), block=std::max(4u,cfg.cacheBlockSize), count=std::max(1u,cfg.cacheCapacity/(block*ways));
  sets_.assign(count,std::vector<CacheLine>(ways)); for(auto& set:sets_)for(auto& line:set)line.data.assign(block,0);
}
CacheLine* DataCache::find(uint32_t a) { uint32_t block=a/cfg_.cacheBlockSize,set=uint32_t(block%sets_.size()),tag=uint32_t(block/sets_.size());for(auto&l:sets_[set])if(l.valid&&l.tag==tag)return &l;return nullptr; }
uint32_t DataCache::beginAccess(uint32_t a,bool wr,std::vector<uint8_t>& mem) {
  wr?++stats_.writes:++stats_.reads; ++tick_; if(auto*l=find(a)){++stats_.hits;l->lru=tick_;return std::max(1u,cfg_.cacheHitLatency);}
  ++stats_.misses; uint32_t block=a/cfg_.cacheBlockSize,set=uint32_t(block%sets_.size()),tag=uint32_t(block/sets_.size()),base=(a/cfg_.cacheBlockSize)*cfg_.cacheBlockSize;
  auto& ways=sets_[set]; auto* victim=&ways[0]; for(auto&l:ways)if(!l.valid){victim=&l;break;}else if(l.lru<victim->lru)victim=&l;
  if(victim->valid&&victim->dirty){++stats_.dirtyWritebacks;uint32_t oldBase=uint32_t(((victim->tag*sets_.size())+set)*cfg_.cacheBlockSize);for(uint32_t i=0;i<cfg_.cacheBlockSize&&oldBase+i<mem.size();++i)mem[oldBase+i]=victim->data[i];}
  victim->valid=true;victim->dirty=false;victim->tag=tag;victim->lru=tick_;for(uint32_t i=0;i<cfg_.cacheBlockSize;++i)victim->data[i]=(base+i<mem.size())?mem[base+i]:0;
  uint32_t latency=std::max(1u,cfg_.cacheHitLatency)+cfg_.cacheMissPenalty;stats_.stallCycles+=latency-1;return latency;
}
uint32_t DataCache::readWord(uint32_t a) const { uint32_t block=a/cfg_.cacheBlockSize,set=uint32_t(block%sets_.size()),tag=uint32_t(block/sets_.size()),off=a%cfg_.cacheBlockSize;for(const auto&l:sets_[set])if(l.valid&&l.tag==tag)return uint32_t(l.data[off])|(uint32_t(l.data[off+1])<<8)|(uint32_t(l.data[off+2])<<16)|(uint32_t(l.data[off+3])<<24);return 0; }
void DataCache::writeWord(uint32_t a,uint32_t v) { if(auto*l=find(a)){uint32_t o=a%cfg_.cacheBlockSize;l->data[o]=uint8_t(v);l->data[o+1]=uint8_t(v>>8);l->data[o+2]=uint8_t(v>>16);l->data[o+3]=uint8_t(v>>24);l->dirty=true;l->lru=++tick_;} }
void DataCache::patchByte(uint32_t a,uint8_t v){if(auto*l=find(a))l->data[a%cfg_.cacheBlockSize]=v;}
uint8_t DataCache::inspectByte(uint32_t a,const std::vector<uint8_t>& mem)const{if(a>=mem.size()||sets_.empty())return 0;uint32_t block=a/cfg_.cacheBlockSize,set=uint32_t(block%sets_.size()),tag=uint32_t(block/sets_.size()),off=a%cfg_.cacheBlockSize;for(const auto&l:sets_[set])if(l.valid&&l.tag==tag&&off<l.data.size())return l.data[off];return mem[a];}
void DataCache::overlayMemory(std::vector<uint8_t>& mem)const{for(size_t set=0;set<sets_.size();++set)for(const auto&l:sets_[set])if(l.valid){uint64_t base=((uint64_t(l.tag)*sets_.size())+set)*cfg_.cacheBlockSize;for(size_t i=0;i<l.data.size()&&base+i<mem.size();++i)mem[base+i]=l.data[i];}}

Simulator::Simulator(){ reset(); }
std::string Simulator::assemble(const std::string& source) {
  auto p=Assembler{}.assemble(source); std::ostringstream o;o<<"{\"ok\":"<<(p.ok()?"true":"false")<<",\"words\":[";for(size_t i=0;i<p.words.size();++i){if(i)o<<',';o<<p.words[i];}o<<"],\"sourceLines\":[";for(size_t i=0;i<p.sourceLines.size();++i){if(i)o<<',';o<<p.sourceLines[i];}o<<"],\"errors\":[";for(size_t i=0;i<p.errors.size();++i){if(i)o<<',';o<<"{\"line\":"<<p.errors[i].line<<",\"column\":"<<p.errors[i].column<<",\"message\":\""<<jsonEscape(p.errors[i].message)<<"\"}";}o<<"]}";return o.str();
}
bool Simulator::loadProgram(const std::string& source) { auto p=Assembler{}.assemble(source);if(!p.ok()){program_=std::move(p);source_=source;status_="assembly-error";return false;}program_=std::move(p);source_=source;reset();return true; }

void Simulator::reset() {
  regs_.fill(0); memory_.assign(std::max(1024u,cfg_.memoryBytes),0); regs_[29]=std::min<uint32_t>(cfg_.initialStackPointer,uint32_t(memory_.size()-4));pc_=0;nextId_=1;
  ifid_={};idex_={};exmem1_={};mem1mem2_={};mem2wb_={};stats_={};events_.clear();timeline_.clear();history_.clear();halted_=fetchStopped_=faulted_=watchpointHit_=false;status_=program_.ok()?"ready":"assembly-error";memWait_=0;memAccessStarted_=false;
  predictor_.reset(cfg_.predictor,cfg_.predictorEntries);cache_.reset(cfg_);
  for(size_t i=0;i<program_.words.size();++i)writeLE(memory_,uint32_t(i*4),program_.words[i]);
  initialRegs_=regs_;initialMemory_=memory_;referenceComparable_=true;
}
void Simulator::resetWithJson(const std::string& j) {
  (void)applyConfigurationJson(j);
}
std::string Simulator::validateConfigurationJson(const std::string& j) const {
  return configurationResultJson(parseConfiguration(j));
}
std::string Simulator::applyConfigurationJson(const std::string& j) {
  auto parsed = parseConfiguration(j);
  if (!parsed.errors.empty()) return configurationResultJson(parsed);
  cfg_ = parsed.configuration;
  reset();
  return configurationResultJson(parsed);
}
void Simulator::snapshot(){Snapshot s;s.regs=regs_;s.memory=memory_;s.initialRegs=initialRegs_;s.initialMemory=initialMemory_;s.pc=pc_;s.nextId=nextId_;s.ifid=ifid_;s.idex=idex_;s.exmem1=exmem1_;s.mem1mem2=mem1mem2_;s.mem2wb=mem2wb_;s.stats=stats_;s.predictor=predictor_;s.cache=cache_;s.halted=halted_;s.fetchStopped=fetchStopped_;s.faulted=faulted_;s.watchpointHit=watchpointHit_;s.referenceComparable=referenceComparable_;s.status=status_;s.memWait=memWait_;s.memAccessStarted=memAccessStarted_;s.timelineSize=timeline_.size();history_.push_back(std::move(s));if(history_.size()>500)history_.pop_front();}
bool Simulator::restorePreviousCycle(){if(history_.empty())return false;auto s=std::move(history_.back());history_.pop_back();regs_=s.regs;memory_=std::move(s.memory);initialRegs_=s.initialRegs;initialMemory_=std::move(s.initialMemory);pc_=s.pc;nextId_=s.nextId;ifid_=s.ifid;idex_=s.idex;exmem1_=s.exmem1;mem1mem2_=s.mem1mem2;mem2wb_=s.mem2wb;stats_=s.stats;predictor_=s.predictor;cache_=s.cache;halted_=s.halted;fetchStopped_=s.fetchStopped;faulted_=s.faulted;watchpointHit_=s.watchpointHit;referenceComparable_=s.referenceComparable;status_=s.status;memWait_=s.memWait;memAccessStarted_=s.memAccessStarted;if(s.droppedTimelineFrame){if(!timeline_.empty())timeline_.pop_back();timeline_.push_front(std::move(s.droppedFrame));}else timeline_.resize(s.timelineSize);events_.clear();events_.push_back({"undo",stats_.cycles,"",{},-1,"","Restored the previous deterministic cycle snapshot."});return true;}
bool Simulator::restoreCycle(uint64_t cycle){
  if(cycle==stats_.cycles)return true;
  if(cycle>stats_.cycles)return false;
  bool available=false;for(const auto&s:history_)if(s.stats.cycles==cycle){available=true;break;}
  if(!available)return false;
  const auto from=stats_.cycles;
  while(stats_.cycles>cycle)if(!restorePreviousCycle())return false;
  events_.clear();events_.push_back({"rewind",stats_.cycles,"",{},-1,"history","Rewound the simulator from cycle "+std::to_string(from)+" to cycle "+std::to_string(cycle)+"."});
  return true;
}
void Simulator::fault(const std::string&m,const std::string&stage,uint64_t id){faulted_=true;fetchStopped_=true;status_="fault";events_.push_back({"fault",stats_.cycles,stage,{id},-1,"",m});}
uint32_t Simulator::loadWord(uint32_t a){if((a&3)!=0){fault("Unaligned 32-bit load at address 0x"+static_cast<std::ostringstream&&>(std::ostringstream()<<std::hex<<a).str(),"MEM2",mem1mem2_.id);return 0;}if(uint64_t(a)+4>memory_.size()){fault("Out-of-bounds load at address "+std::to_string(a),"MEM2",mem1mem2_.id);return 0;}return cfg_.cacheEnabled?cache_.readWord(a):readLE(memory_,a);}
void Simulator::storeWord(uint32_t a,uint32_t v){
  if((a&3)!=0){fault("Unaligned 32-bit store at address "+std::to_string(a),"MEM2",mem1mem2_.id);return;}
  if(uint64_t(a)+4>memory_.size()){fault("Out-of-bounds store at address "+std::to_string(a),"MEM2",mem1mem2_.id);return;}
  uint32_t old=0;for(uint32_t i=0;i<4;++i)old|=uint32_t(cfg_.cacheEnabled?cache_.inspectByte(a+i,memory_):memory_[a+i])<<(8*i);
  if(cfg_.cacheEnabled)cache_.writeWord(a,v);else writeLE(memory_,a,v);
  ++stats_.memoryWrites;
  events_.push_back({"memory-write",stats_.cycles,"MEM2",{mem1mem2_.id},-1,"", "Stored 0x"+static_cast<std::ostringstream&&>(std::ostringstream()<<std::hex<<v).str()+" at address 0x"+static_cast<std::ostringstream&&>(std::ostringstream()<<std::hex<<a).str()+"."});
  if(memoryWatchpoints_.count(a)){
    watchpointHit_=true;status_="watchpoint";
    Event e{"watchpoint",stats_.cycles,"MEM2",{mem1mem2_.id},-1,"memory","Memory watchpoint hit: instruction #"+std::to_string(mem1mem2_.id)+" stored "+std::to_string(int32_t(v))+" at address 0x"+static_cast<std::ostringstream&&>(std::ostringstream()<<std::hex<<a).str()+" (previous word "+std::to_string(int32_t(old))+")."};
    e.watchpointKind="memory";e.access="write";e.address=a;e.oldValue=old;e.newValue=v;events_.push_back(std::move(e));
  }
}
bool Simulator::pipelineEmpty()const{return!ifid_.valid&&!idex_.valid&&!exmem1_.valid&&!mem1mem2_.valid&&!mem2wb_.valid;}

uint32_t Simulator::forwardedValue(uint8_t r,uint32_t original,const std::string&operand,uint64_t consumer){
  if(r==0||cfg_.forwarding!=ForwardingMode::Full)return r==0?0:original;
  struct C{const PipelineSlot*s;const char*n;}; C cs[]={{&exmem1_,"EX/MEM1"},{&mem1mem2_,"MEM1/MEM2"},{&mem2wb_,"MEM2/WB"}};
  for(const auto&c:cs)if(writes(*c.s,r)){if(c.s->decoded.isLoad&&c.s==&exmem1_)continue;uint32_t v=c.s->decoded.isLoad?(c.s==&mem1mem2_?loadWord(c.s->memoryAddress):c.s->writeValue):c.s->writeValue;events_.push_back({"forward",stats_.cycles,"EX",{c.s->id,consumer},r,c.n,"Forwarded r"+std::to_string(r)+" from "+c.n+" to EX operand "+operand+"."});++stats_.forwardingEvents;return v;}
  return original;
}

bool Simulator::shouldStall(const Decoded& d,std::string&reason,uint8_t&reg,uint64_t&producer)const{
  if(cfg_.forwarding==ForwardingMode::Manual)return false;
  auto check=[&](uint8_t r)->bool{if(r==0)return false;if(cfg_.forwarding==ForwardingMode::Full){if(writes(idex_,r)&&idex_.decoded.isLoad){reg=r;producer=idex_.id;reason="load result is not available until MEM2";return true;}return false;}for(auto*s:{&idex_,&exmem1_,&mem1mem2_})if(writes(*s,r)){reg=r;producer=s->id;reason="value is not yet visible in the register file";return true;}return false;};
  return(d.usesRs1&&check(d.rs1))||(d.usesRs2&&check(d.rs2));
}

PipelineSlot Simulator::fetchSlot(uint32_t a){PipelineSlot s;if(a&3){fault("Unaligned instruction fetch at address "+std::to_string(a),"IF",0);return s;}size_t i=a/4;if(i>=program_.words.size()){fetchStopped_=true;return s;}s.valid=true;s.id=nextId_++;s.pc=a;s.raw=program_.words[i];s.decoded=decode(s.raw);s.assembly=program_.assembly[i];s.sourceLine=program_.sourceLines[i];if(s.decoded.op==Op::INVALID)fault("Invalid opcode at PC "+std::to_string(a),"IF",s.id);if(s.decoded.isBranch){s.predictedTaken=predictor_.predict(a);s.predictedTarget=s.predictedTaken?uint32_t(int64_t(a)+4+s.decoded.imm):a+4;}else if(s.decoded.op==Op::J||s.decoded.op==Op::JAL){s.predictedTaken=true;s.predictedTarget=uint32_t(int64_t(a)+4+s.decoded.imm);}else{s.predictedTarget=a+4;}++stats_.fetched;return s;}

PipelineSlot Simulator::execute(const PipelineSlot&in,bool&redirect,uint32_t&target){PipelineSlot o=in;if(!in.valid)return o;auto d=in.decoded;uint32_t a=forwardedValue(d.rs1,in.rs1Value,"A",in.id),b=forwardedValue(d.rs2,in.rs2Value,"B",in.id);o.operandA=a;o.operandB=b;o.regWrite=d.writesRd&&d.rd!=0;o.memRead=d.isLoad;o.memWrite=d.isStore;
  switch(d.op){case Op::ADD:o.aluResult=a+b;break;case Op::SUB:o.aluResult=a-b;break;case Op::MUL:o.aluResult=a*b;break;case Op::ADDI:o.aluResult=a+uint32_t(d.imm);break;case Op::AND:o.aluResult=a&b;break;case Op::OR:o.aluResult=a|b;break;case Op::XOR:o.aluResult=a^b;break;case Op::SLL:o.aluResult=a<<(b&31);break;case Op::SRL:o.aluResult=a>>(b&31);break;case Op::SLT:o.aluResult=int32_t(a)<int32_t(b);break;case Op::LW:case Op::SW:o.memoryAddress=a+uint32_t(d.imm);o.memoryData=b;o.aluResult=o.memoryAddress;break;case Op::LUI:o.aluResult=uint32_t(d.imm);break;case Op::JAL:o.aluResult=in.pc+4;break;default:break;}o.writeValue=o.aluResult;
  if(d.isBranch||d.isJump){bool taken=true;if(d.op==Op::BEQ)taken=a==b;else if(d.op==Op::BNE)taken=a!=b;else if(d.op==Op::BLT)taken=int32_t(a)<int32_t(b);uint32_t actual=in.pc+4;if(taken){actual=d.op==Op::JR?a:uint32_t(int64_t(in.pc)+4+d.imm);}o.actualTaken=taken;o.actualTarget=actual;o.mispredicted=(in.predictedTaken!=taken)||(taken&&in.predictedTarget!=actual);if(d.isBranch){++stats_.branches;auto st=predictor_.update(in.pc,taken);if(o.mispredicted)++stats_.mispredictions;else ++stats_.correctPredictions;events_.push_back({"branch",stats_.cycles,"EX",{in.id},-1,"","Branch #"+std::to_string(in.id)+" was "+(taken?"taken":"not taken")+"; predictor state "+std::to_string(st.first)+" → "+std::to_string(st.second)+"."});}if(o.mispredicted){redirect=true;target=actual;events_.push_back({"mispredict",stats_.cycles,"EX",{in.id},-1,"","Prediction for instruction #"+std::to_string(in.id)+" was wrong; redirected fetch to PC 0x"+static_cast<std::ostringstream&&>(std::ostringstream()<<std::hex<<actual).str()+"."});}}
  return o;
}

std::string Simulator::stepCycle(){
  if(halted_||faulted_)return getState(); if(stats_.cycles>=cfg_.cycleLimit){fault("Cycle limit reached; execution stopped to prevent an infinite run.","",0);return getState();}
  if(!skipSnapshots_)snapshot();watchpointHit_=false;events_.clear();++stats_.cycles;status_="running";
  PipelineSlot n_ifid{},n_idex{},n_exmem1{},n_mem1mem2{},n_mem2wb{},flushedIf{},flushedId{};

  if(mem2wb_.valid){if(mem2wb_.regWrite&&mem2wb_.decoded.rd!=0){const auto rd=mem2wb_.decoded.rd;const auto old=regs_[rd];regs_[rd]=mem2wb_.writeValue;++stats_.registerWrites;events_.push_back({"register-write",stats_.cycles,"WB",{mem2wb_.id},rd,"","Wrote r"+std::to_string(rd)+" = "+std::to_string(int32_t(mem2wb_.writeValue))+"."});if(registerWatchpoints_.count(rd)){watchpointHit_=true;status_="watchpoint";Event e{"watchpoint",stats_.cycles,"WB",{mem2wb_.id},rd,"register","Register watchpoint hit: instruction #"+std::to_string(mem2wb_.id)+" changed r"+std::to_string(rd)+" from "+std::to_string(int32_t(old))+" to "+std::to_string(int32_t(mem2wb_.writeValue))+"."};e.watchpointKind="register";e.access="write";e.oldValue=old;e.newValue=mem2wb_.writeValue;events_.push_back(std::move(e));}}regs_[0]=0;++stats_.retired;if(mem2wb_.decoded.op==Op::HALT){halted_=true;status_="halted";events_.push_back({"halt",stats_.cycles,"WB",{mem2wb_.id},-1,"","HALT retired after all older instructions completed."});}}
  n_mem2wb=mem1mem2_;if(mem1mem2_.valid){if(mem1mem2_.memRead)n_mem2wb.writeValue=loadWord(mem1mem2_.memoryAddress);if(mem1mem2_.memWrite)storeWord(mem1mem2_.memoryAddress,mem1mem2_.memoryData);}

  bool memoryStall=false;
  if(exmem1_.valid&&(exmem1_.memRead||exmem1_.memWrite)&&cfg_.cacheEnabled){
    const auto a=exmem1_.memoryAddress;
    if(!memAccessStarted_&&((a&3)!=0||uint64_t(a)+4>memory_.size())){fault(std::string((a&3)?"Unaligned 32-bit ":"Out-of-bounds ")+(exmem1_.memWrite?"store":"load")+" at address "+std::to_string(a),"MEM1",exmem1_.id);}
    else if(!memAccessStarted_){uint32_t lat=cache_.beginAccess(a,exmem1_.memWrite,memory_);memAccessStarted_=true;memWait_=lat>0?lat-1:0;if(lat>cfg_.cacheHitLatency)events_.push_back({"cache-miss",stats_.cycles,"MEM1",{exmem1_.id},-1,"","Data-cache miss for instruction #"+std::to_string(exmem1_.id)+"; MEM1 will wait "+std::to_string(memWait_)+" extra cycle(s)."});}
    if(memWait_>0){--memWait_;memoryStall=true;++stats_.stallCycles;++stats_.memoryStallCycles;events_.push_back({"stall",stats_.cycles,"MEM1",{exmem1_.id},-1,"cache","Pipeline stalled while the data cache services instruction #"+std::to_string(exmem1_.id)+"."});}
  }
  if(memoryStall){n_mem1mem2={};n_exmem1=exmem1_;n_exmem1.stalled=true;n_idex=idex_;n_idex.stalled=true;n_ifid=ifid_;n_ifid.stalled=true;
    // A younger instruction may have entered ID/EX expecting an older value to
    // be forwarded on the next cycle. A long cache stall can let that producer
    // retire before EX finally runs, so refresh the held register operands from
    // the now-current architectural register file on every stalled cycle.
    if(n_idex.valid){if(n_idex.decoded.usesRs1)n_idex.rs1Value=regs_[n_idex.decoded.rs1];if(n_idex.decoded.usesRs2)n_idex.rs2Value=regs_[n_idex.decoded.rs2];}
  }
  else {
    n_mem1mem2=exmem1_;memAccessStarted_=false;memWait_=0;
    bool redirect=false;uint32_t target=0;n_exmem1=execute(idex_,redirect,target);
    std::string reason;uint8_t hazardReg=0;uint64_t producer=0;bool dataStall=ifid_.valid&&shouldStall(ifid_.decoded,reason,hazardReg,producer);
    if(dataStall){n_idex={};n_idex.bubble=true;n_ifid=ifid_;n_ifid.stalled=true;++stats_.stallCycles;++stats_.dataStallCycles;events_.push_back({"stall",stats_.cycles,"ID",{producer,ifid_.id},hazardReg,"hazard","Stalled ID because r"+std::to_string(hazardReg)+" is produced by instruction #"+std::to_string(producer)+" and "+reason+"."});events_.push_back({"bubble",stats_.cycles,"EX",{ifid_.id},hazardReg,"hazard","Inserted a bubble into EX while instruction #"+std::to_string(ifid_.id)+" remains in ID."});}
    else if(ifid_.valid){n_idex=ifid_;n_idex.rs1Value=regs_[ifid_.decoded.rs1];n_idex.rs2Value=regs_[ifid_.decoded.rs2];if(ifid_.decoded.op==Op::HALT)fetchStopped_=true;}
    if(!dataStall&&!fetchStopped_&&!faulted_){n_ifid=fetchSlot(pc_);pc_=n_ifid.valid?n_ifid.predictedTarget:pc_;}
    if(dataStall){/* PC and IF/ID remain unchanged. */}
    if(redirect){std::vector<uint64_t> flushed;flushedId=n_idex;flushedIf=n_ifid;flushedId.squashed=flushedId.valid;flushedIf.squashed=flushedIf.valid;if(n_idex.valid)flushed.push_back(n_idex.id);if(n_ifid.valid)flushed.push_back(n_ifid.id);stats_.flushedInstructions+=flushed.size();stats_.controlPenalty+=flushed.size();n_idex={};n_ifid={};pc_=target;fetchStopped_=false;if(!flushed.empty()){std::string ids;for(size_t i=0;i<flushed.size();++i){if(i)ids+=" and #";else ids+="#";ids+=std::to_string(flushed[i]);}events_.push_back({"flush",stats_.cycles,"EX",flushed,-1,"control","Flushed instructions "+ids+" after control flow resolved in EX."});}}
  }
  ifid_=n_ifid;idex_=n_idex;exmem1_=n_exmem1;mem1mem2_=n_mem1mem2;mem2wb_=n_mem2wb;regs_[0]=0;
  // Preserve the values visible at the ID-stage register-file ports for
  // serialization and timeline inspection. Execution re-reads them when the
  // instruction advances into ID/EX, so this display state cannot affect CPU behavior.
  if(ifid_.valid){ifid_.rs1Value=regs_[ifid_.decoded.rs1];ifid_.rs2Value=regs_[ifid_.decoded.rs2];}
  TimelineFrame f;f.cycle=stats_.cycles;f.slots={PipelineSlot{},ifid_,idex_,exmem1_,mem1mem2_,mem2wb_};
  if(!fetchStopped_&&pc_/4<program_.words.size()){f.slots[0].valid=true;f.slots[0].pc=pc_;f.slots[0].assembly=program_.assembly[pc_/4];f.slots[0].sourceLine=program_.sourceLines[pc_/4];f.slots[0].decoded=decode(program_.words[pc_/4]);}
  if(flushedIf.valid)f.slots[0]=flushedIf;if(flushedId.valid)f.slots[1]=flushedId;
  f.events=events_;timeline_.push_back(std::move(f));if(timeline_.size()>1000){if(skipSnapshots_)timeline_.pop_front();else{history_.back().droppedTimelineFrame=true;history_.back().droppedFrame=std::move(timeline_.front());timeline_.pop_front();}}
  if(fetchStopped_&&pipelineEmpty()&&!halted_&&!faulted_){halted_=true;if(!watchpointHit_)status_="completed";}
  return batchRunning_?std::string{}:getState();
}

std::string Simulator::stepInstruction(){uint64_t before=stats_.retired;do{stepCycle();}while(!halted_&&!faulted_&&!watchpointHit_&&stats_.retired==before);return getState();}
std::string Simulator::runCycles(uint32_t n){batchRunning_=true;for(uint32_t i=0;i<n&&!halted_&&!faulted_;++i){if(i>0&&watchpointHit_)break;if(breakpoints_.count(pc_)){status_="breakpoint";break;}stepCycle();if(watchpointHit_)break;}batchRunning_=false;return getState();}
std::string Simulator::runUntilCompletion(uint32_t n){history_.clear();skipSnapshots_=true;runCycles(n);skipSnapshots_=false;if(!halted_&&!faulted_&&!watchpointHit_&&stats_.cycles>=cfg_.cycleLimit)fault("Cycle limit reached; execution stopped to prevent an infinite run.","",0);return getState();}
std::string Simulator::runUntilBreakpoint(uint32_t n){history_.clear();skipSnapshots_=true;auto result=runCycles(n);skipSnapshots_=false;return result;}
void Simulator::setBreakpoint(uint32_t a,bool on){if(on)breakpoints_.insert(a);else breakpoints_.erase(a);}
bool Simulator::setRegisterWatchpoint(uint32_t i,bool on){if(i==0||i>=32)return false;if(on&&registerWatchpoints_.count(i)==0&&registerWatchpoints_.size()>=64)return false;if(on)registerWatchpoints_.insert(i);else registerWatchpoints_.erase(i);return true;}
bool Simulator::setMemoryWatchpoint(uint32_t a,bool on){if((a&3)!=0||uint64_t(a)+4>memory_.size())return false;if(on&&memoryWatchpoints_.count(a)==0&&memoryWatchpoints_.size()>=64)return false;if(on)memoryWatchpoints_.insert(a);else memoryWatchpoints_.erase(a);return true;}
void Simulator::setRegister(uint32_t i,uint32_t v){if(i>0&&i<32){regs_[i]=v;if(stats_.cycles==0)initialRegs_[i]=v;else referenceComparable_=false;}regs_[0]=0;initialRegs_[0]=0;}
std::string Simulator::readMemory(uint32_t a,uint32_t len)const{std::ostringstream o;o<<'[';for(uint32_t i=0;i<len&&uint64_t(a)+i<memory_.size();++i){if(i)o<<',';o<<unsigned(cfg_.cacheEnabled?cache_.inspectByte(a+i,memory_):memory_[a+i]);}o<<']';return o.str();}
bool Simulator::writeMemory(uint32_t a,const std::string& csv){std::istringstream in(csv);std::string x;std::vector<uint8_t> bytes;while(std::getline(in,x,',')){int64_t v=0;if(!parseInteger(trim(x),v)||v<0||v>255)return false;bytes.push_back(uint8_t(v));}if(bytes.empty()||uint64_t(a)+bytes.size()>memory_.size())return false;for(size_t i=0;i<bytes.size();++i){memory_[a+i]=bytes[i];if(cfg_.cacheEnabled)cache_.patchByte(a+uint32_t(i),bytes[i]);if(stats_.cycles==0)initialMemory_[a+i]=bytes[i];}if(stats_.cycles>0)referenceComparable_=false;events_.push_back({"memory-edit",stats_.cycles,"",{},-1,"ui","Edited "+std::to_string(bytes.size())+" byte(s) at address "+std::to_string(a)+"."});return true;}
std::vector<uint8_t> Simulator::coherentMemory()const{auto result=memory_;if(cfg_.cacheEnabled)cache_.overlayMemory(result);return result;}
std::string Simulator::getInitialState()const{std::ostringstream o;o<<"{\"registers\":[";for(size_t i=0;i<initialRegs_.size();++i){if(i)o<<',';o<<initialRegs_[i];}o<<"],\"memory\":[";for(size_t i=0;i<initialMemory_.size();++i){if(i)o<<',';o<<unsigned(initialMemory_[i]);}o<<"]}";return o.str();}

std::string Simulator::slotJson(const PipelineSlot&s,const std::string&stage)const{std::ostringstream o;o<<"{\"stage\":\""<<stage<<"\",\"valid\":"<<(s.valid?"true":"false")<<",\"stalled\":"<<(s.stalled?"true":"false")<<",\"bubble\":"<<(s.bubble?"true":"false")<<",\"squashed\":"<<(s.squashed?"true":"false")<<",\"id\":"<<s.id<<",\"pc\":"<<s.pc<<",\"raw\":"<<s.raw<<",\"op\":\""<<opName(s.decoded.op)<<"\",\"assembly\":\""<<jsonEscape(s.assembly)<<"\",\"sourceLine\":"<<s.sourceLine<<",\"rs1\":"<<unsigned(s.decoded.rs1)<<",\"rs2\":"<<unsigned(s.decoded.rs2)<<",\"rd\":"<<unsigned(s.decoded.rd)<<",\"usesRs1\":"<<(s.decoded.usesRs1?"true":"false")<<",\"usesRs2\":"<<(s.decoded.usesRs2?"true":"false")<<",\"writesRd\":"<<(s.decoded.writesRd?"true":"false")<<",\"isLoad\":"<<(s.decoded.isLoad?"true":"false")<<",\"isStore\":"<<(s.decoded.isStore?"true":"false")<<",\"immediate\":"<<s.decoded.imm<<",\"rs1Value\":"<<s.rs1Value<<",\"rs2Value\":"<<s.rs2Value<<",\"operandA\":"<<s.operandA<<",\"operandB\":"<<s.operandB<<",\"aluResult\":"<<s.aluResult<<",\"memoryAddress\":"<<s.memoryAddress<<",\"memoryData\":"<<s.memoryData<<",\"writeValue\":"<<s.writeValue<<",\"regWrite\":"<<(s.regWrite?"true":"false")<<",\"memRead\":"<<(s.memRead?"true":"false")<<",\"memWrite\":"<<(s.memWrite?"true":"false")<<",\"predictedTaken\":"<<(s.predictedTaken?"true":"false")<<",\"predictedTarget\":"<<s.predictedTarget<<",\"actualTaken\":"<<(s.actualTaken?"true":"false")<<",\"actualTarget\":"<<s.actualTarget<<",\"mispredicted\":"<<(s.mispredicted?"true":"false")<<'}';return o.str();}
std::string Simulator::getEvents()const{return eventsJson(events_);}
std::string Simulator::getTimeline()const{std::ostringstream o;o<<'[';for(size_t i=0;i<timeline_.size();++i){if(i)o<<',';o<<"{\"cycle\":"<<timeline_[i].cycle<<",\"stages\":[";static const char* names[]={"IF","ID","EX","MEM1","MEM2","WB"};for(int k=0;k<6;++k){if(k)o<<',';o<<slotJson(timeline_[i].slots[k],names[k]);}o<<"],\"events\":"<<eventsJson(timeline_[i].events)<<'}';}o<<']';return o.str();}
std::string Simulator::getHistory()const{std::ostringstream o;o<<"{\"currentCycle\":"<<stats_.cycles<<",\"capacity\":500,\"rewindAvailable\":"<<(!history_.empty()?"true":"false")<<",\"oldestRewindableCycle\":"<<(history_.empty()?stats_.cycles:history_.front().stats.cycles)<<",\"cycles\":[";for(size_t i=0;i<history_.size();++i){if(i)o<<',';o<<history_[i].stats.cycles;}if(!history_.empty())o<<',';o<<stats_.cycles<<"]}";return o.str();}
std::string Simulator::compareReference()const{
  std::ostringstream o;
  if(!halted_&&!faulted_){return "{\"comparable\":false,\"matches\":false,\"referenceHalted\":false,\"error\":\"\",\"differences\":[],\"memoryDifferences\":[],\"message\":\"Run the program to completion before comparing it with the reference interpreter.\"}";}
  if(!referenceComparable_){return "{\"comparable\":false,\"matches\":false,\"referenceHalted\":false,\"error\":\"Architectural state was edited after execution began.\",\"differences\":[],\"memoryDifferences\":[],\"message\":\"Reference comparison is unavailable after a mid-run register or memory edit; reset and apply edits before the first cycle.\"}";}
  auto ref=ReferenceInterpreter{}.runWithInitialState(program_,cfg_,cfg_.cycleLimit,initialRegs_,initialMemory_);
  std::vector<size_t> differences;for(size_t i=1;i<regs_.size();++i)if(regs_[i]!=ref.registers[i])differences.push_back(i);
  const auto actualMemory=coherentMemory();std::vector<size_t> memoryDifferences;for(size_t i=0;i<std::min(actualMemory.size(),ref.memory.size());++i)if(actualMemory[i]!=ref.memory[i])memoryDifferences.push_back(i);
  bool matches=ref.error.empty()&&ref.halted&&differences.empty()&&memoryDifferences.empty()&&!faulted_;
  o<<"{\"comparable\":true,\"matches\":"<<(matches?"true":"false")<<",\"referenceHalted\":"<<(ref.halted?"true":"false")<<",\"error\":\""<<jsonEscape(ref.error)<<"\",\"differences\":[";
  for(size_t i=0;i<differences.size();++i){if(i)o<<',';auto r=differences[i];o<<"{\"register\":"<<r<<",\"actual\":"<<regs_[r]<<",\"expected\":"<<ref.registers[r]<<'}';}
  o<<"],\"memoryDifferences\":[";for(size_t i=0;i<std::min<size_t>(memoryDifferences.size(),32);++i){if(i)o<<',';auto a=memoryDifferences[i];o<<"{\"address\":"<<a<<",\"actual\":"<<unsigned(actualMemory[a])<<",\"expected\":"<<unsigned(ref.memory[a])<<'}';}o<<"],\"message\":\"";
  if(matches)o<<"Pipeline result matches the non-pipelined reference interpreter.";
  else if(faulted_)o<<"The pipeline faulted before architectural completion.";
  else if(!ref.error.empty())o<<"Reference execution failed: "<<jsonEscape(ref.error)<<'.';
  else o<<differences.size()<<" register value(s) and "<<memoryDifferences.size()<<" memory byte(s) differ from the reference result. Check manual scheduling and dependency hazards.";
  o<<"\"}";return o.str();
}
std::string Simulator::getState()const{std::ostringstream o;o<<"{\"status\":\""<<status_<<"\",\"halted\":"<<(halted_?"true":"false")<<",\"faulted\":"<<(faulted_?"true":"false")<<",\"pc\":"<<pc_<<",\"configuration\":"<<configurationJson(cfg_)<<",\"registers\":[";for(size_t i=0;i<32;++i){if(i)o<<',';o<<regs_[i];}o<<"],\"pipeline\":["<<slotJson(ifid_,"ID")<<','<<slotJson(idex_,"EX")<<','<<slotJson(exmem1_,"MEM1")<<','<<slotJson(mem1mem2_,"MEM2")<<','<<slotJson(mem2wb_,"WB")<<"],\"statistics\":{";
  o<<"\"cycles\":"<<stats_.cycles<<",\"fetched\":"<<stats_.fetched<<",\"retired\":"<<stats_.retired<<",\"cpi\":"<<(stats_.retired?double(stats_.cycles)/stats_.retired:0)<<",\"ipc\":"<<(stats_.cycles?double(stats_.retired)/stats_.cycles:0)<<",\"stallCycles\":"<<stats_.stallCycles<<",\"dataStallCycles\":"<<stats_.dataStallCycles<<",\"memoryStallCycles\":"<<stats_.memoryStallCycles<<",\"controlPenalty\":"<<stats_.controlPenalty<<",\"forwardingEvents\":"<<stats_.forwardingEvents<<",\"flushedInstructions\":"<<stats_.flushedInstructions<<",\"branches\":"<<stats_.branches<<",\"correctPredictions\":"<<stats_.correctPredictions<<",\"mispredictions\":"<<stats_.mispredictions<<",\"registerWrites\":"<<stats_.registerWrites<<",\"memoryWrites\":"<<stats_.memoryWrites<<"},\"events\":"<<getEvents()<<",\"predictorTable\":[";
  const auto&pt=predictor_.entries();for(size_t i=0;i<pt.size();++i){if(i)o<<',';o<<"{\"index\":"<<i<<",\"valid\":"<<(pt[i].valid?"true":"false")<<",\"pc\":"<<pt[i].tagPc<<",\"state\":"<<unsigned(pt[i].state)<<",\"prediction\":"<<(pt[i].valid&&predictor_.predict(pt[i].tagPc)?"true":"false")<<",\"recentTaken\":"<<(pt[i].recentTaken?"true":"false")<<'}';}
  auto&sets=cache_.sets();const size_t ways=sets.empty()?1:std::max<size_t>(1,sets[0].size()),visibleCount=std::min(sets.size(),std::max<size_t>(1,512/ways));
  o<<"],\"cache\":{\"reads\":"<<cache_.stats().reads<<",\"writes\":"<<cache_.stats().writes<<",\"hits\":"<<cache_.stats().hits<<",\"misses\":"<<cache_.stats().misses<<",\"dirtyWritebacks\":"<<cache_.stats().dirtyWritebacks<<",\"stallCycles\":"<<cache_.stats().stallCycles<<",\"totalSets\":"<<sets.size()<<",\"visibleSetIndices\":[";for(size_t s=0;s<visibleCount;++s){if(s)o<<',';o<<s;}o<<"],\"sets\":[";for(size_t s=0;s<visibleCount;++s){if(s)o<<',';o<<'[';for(size_t w=0;w<sets[s].size();++w){if(w)o<<',';auto&l=sets[s][w];o<<"{\"valid\":"<<(l.valid?"true":"false")<<",\"dirty\":"<<(l.dirty?"true":"false")<<",\"tag\":"<<l.tag<<",\"lru\":"<<l.lru<<",\"preview\":\"";for(size_t b=0;b<std::min<size_t>(8,l.data.size());++b)o<<std::hex<<std::setw(2)<<std::setfill('0')<<unsigned(l.data[b]);o<<std::dec<<"\"}";}o<<']';}o<<"]},\"breakpoints\":[";size_t bi=0;for(auto b:breakpoints_){if(bi++)o<<',';o<<b;}o<<"],\"registerWatchpoints\":[";size_t rwi=0;for(auto r:registerWatchpoints_){if(rwi++)o<<',';o<<r;}o<<"],\"memoryWatchpoints\":[";size_t mwi=0;for(auto a:memoryWatchpoints_){if(mwi++)o<<',';o<<a;}o<<"]}";return o.str();}

ReferenceResult ReferenceInterpreter::run(const Program&p,const Configuration&cfg,uint64_t max)const{ReferenceResult r;r.memory.assign(std::max(1024u,cfg.memoryBytes),0);r.registers.fill(0);r.registers[29]=std::min<uint32_t>(cfg.initialStackPointer,uint32_t(r.memory.size()-4));for(size_t i=0;i<p.words.size();++i)writeLE(r.memory,uint32_t(i*4),p.words[i]);while(r.steps++<max){if(r.pc&3||r.pc/4>=p.words.size()){r.error="Invalid PC";break;}auto d=decode(p.words[r.pc/4]);uint32_t next=r.pc+4,a=r.registers[d.rs1],b=r.registers[d.rs2],v=0;switch(d.op){case Op::NOP:break;case Op::ADD:v=a+b;break;case Op::SUB:v=a-b;break;case Op::MUL:v=a*b;break;case Op::ADDI:v=a+uint32_t(d.imm);break;case Op::AND:v=a&b;break;case Op::OR:v=a|b;break;case Op::XOR:v=a^b;break;case Op::SLL:v=a<<(b&31);break;case Op::SRL:v=a>>(b&31);break;case Op::SLT:v=int32_t(a)<int32_t(b);break;case Op::LUI:v=uint32_t(d.imm);break;case Op::LW:{uint32_t x=a+uint32_t(d.imm);if((x&3)||uint64_t(x)+4>r.memory.size()){r.error="Invalid load";return r;}v=readLE(r.memory,x);break;}case Op::SW:{uint32_t x=a+uint32_t(d.imm);if((x&3)||uint64_t(x)+4>r.memory.size()){r.error="Invalid store";return r;}writeLE(r.memory,x,b);break;}case Op::BEQ:if(a==b)next=uint32_t(int64_t(r.pc)+4+d.imm);break;case Op::BNE:if(a!=b)next=uint32_t(int64_t(r.pc)+4+d.imm);break;case Op::BLT:if(int32_t(a)<int32_t(b))next=uint32_t(int64_t(r.pc)+4+d.imm);break;case Op::J:next=uint32_t(int64_t(r.pc)+4+d.imm);break;case Op::JAL:v=r.pc+4;next=uint32_t(int64_t(r.pc)+4+d.imm);break;case Op::JR:next=a;break;case Op::HALT:r.halted=true;r.pc=next;return r;default:r.error="Invalid opcode";return r;}if(d.writesRd&&d.rd)r.registers[d.rd]=v;r.registers[0]=0;r.pc=next;}if(!r.halted&&r.error.empty())r.error="Step limit reached";return r;}

ReferenceResult ReferenceInterpreter::runWithInitialState(const Program& p,const Configuration& cfg,uint64_t max,const std::array<uint32_t,32>& initialRegisters,const std::vector<uint8_t>& initialMemory)const{
  ReferenceResult r;r.memory=initialMemory;r.registers=initialRegisters;r.registers[0]=0;
  if(r.memory.size()!=std::max(1024u,cfg.memoryBytes)){r.error="Initial memory size does not match the processor configuration";return r;}
  while(r.steps++<max){
    if(r.pc&3||r.pc/4>=p.words.size()){r.error="Invalid PC";break;}
    auto d=decode(p.words[r.pc/4]);uint32_t next=r.pc+4,a=r.registers[d.rs1],b=r.registers[d.rs2],v=0;
    switch(d.op){
      case Op::NOP:break;case Op::ADD:v=a+b;break;case Op::SUB:v=a-b;break;case Op::MUL:v=a*b;break;case Op::ADDI:v=a+uint32_t(d.imm);break;
      case Op::AND:v=a&b;break;case Op::OR:v=a|b;break;case Op::XOR:v=a^b;break;case Op::SLL:v=a<<(b&31);break;case Op::SRL:v=a>>(b&31);break;
      case Op::SLT:v=int32_t(a)<int32_t(b);break;case Op::LUI:v=uint32_t(d.imm);break;
      case Op::LW:{uint32_t x=a+uint32_t(d.imm);if((x&3)||uint64_t(x)+4>r.memory.size()){r.error="Invalid load";return r;}v=readLE(r.memory,x);break;}
      case Op::SW:{uint32_t x=a+uint32_t(d.imm);if((x&3)||uint64_t(x)+4>r.memory.size()){r.error="Invalid store";return r;}writeLE(r.memory,x,b);break;}
      case Op::BEQ:if(a==b)next=uint32_t(int64_t(r.pc)+4+d.imm);break;case Op::BNE:if(a!=b)next=uint32_t(int64_t(r.pc)+4+d.imm);break;
      case Op::BLT:if(int32_t(a)<int32_t(b))next=uint32_t(int64_t(r.pc)+4+d.imm);break;case Op::J:next=uint32_t(int64_t(r.pc)+4+d.imm);break;
      case Op::JAL:v=r.pc+4;next=uint32_t(int64_t(r.pc)+4+d.imm);break;case Op::JR:next=a;break;
      case Op::HALT:r.halted=true;r.pc=next;return r;default:r.error="Invalid opcode";return r;
    }
    if(d.writesRd&&d.rd)r.registers[d.rd]=v;r.registers[0]=0;r.pc=next;
  }
  if(!r.halted&&r.error.empty())r.error="Step limit reached";return r;
}

}  // namespace cpulab
