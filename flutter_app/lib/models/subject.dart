import 'package:uuid/uuid.dart';

class Subject {
  final String id;
  String name;
  String? code;
  int target; // target attendance %
  int attended;
  int total;

  Subject({
    String? id,
    required this.name,
    this.code,
    this.target = 75,
    this.attended = 0,
    this.total = 0,
  }) : id = id ?? const Uuid().v4();

  double get percentage => total == 0 ? 0 : (attended / total) * 100;

  /// classes you can skip while keeping >= target
  int canSkip() {
    if (total == 0) return 0;
    int skip = 0;
    int a = attended, t = total;
    while (((a / (t + 1)) * 100) >= target) {
      t += 1;
      skip += 1;
      if (skip > 500) break;
    }
    return skip;
  }

  /// classes you must attend to reach target
  int mustAttend() {
    if (percentage >= target) return 0;
    int a = attended, t = total, need = 0;
    while (((a + need) / (t + need)) * 100 < target) {
      need += 1;
      if (need > 500) break;
    }
    return need;
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'code': code,
        'target': target,
        'attended': attended,
        'total': total,
      };

  factory Subject.fromJson(Map<String, dynamic> j) => Subject(
        id: j['id'] as String?,
        name: j['name'] as String,
        code: j['code'] as String?,
        target: (j['target'] ?? 75) as int,
        attended: (j['attended'] ?? 0) as int,
        total: (j['total'] ?? 0) as int,
      );
}
