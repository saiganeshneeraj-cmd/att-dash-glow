import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/subject.dart';

class StorageService extends ChangeNotifier {
  StorageService._();
  static final StorageService instance = StorageService._();

  static const _key = 'subjects_v1';
  late SharedPreferences _prefs;
  List<Subject> _subjects = [];

  List<Subject> get subjects => List.unmodifiable(_subjects);

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    final raw = _prefs.getString(_key);
    if (raw != null) {
      final list = (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
      _subjects = list.map(Subject.fromJson).toList();
    }
  }

  Future<void> _persist() async {
    await _prefs.setString(
      _key,
      jsonEncode(_subjects.map((s) => s.toJson()).toList()),
    );
    notifyListeners();
  }

  Future<void> add(Subject s) async {
    _subjects.add(s);
    await _persist();
  }

  Future<void> update(Subject s) async {
    final i = _subjects.indexWhere((x) => x.id == s.id);
    if (i >= 0) _subjects[i] = s;
    await _persist();
  }

  Future<void> remove(String id) async {
    _subjects.removeWhere((s) => s.id == id);
    await _persist();
  }

  Future<void> markPresent(String id) async {
    final s = _subjects.firstWhere((x) => x.id == id);
    s.attended += 1;
    s.total += 1;
    await _persist();
  }

  Future<void> markAbsent(String id) async {
    final s = _subjects.firstWhere((x) => x.id == id);
    s.total += 1;
    await _persist();
  }

  Future<void> undo(String id) async {
    final s = _subjects.firstWhere((x) => x.id == id);
    if (s.total > 0) s.total -= 1;
    if (s.attended > s.total) s.attended = s.total;
    await _persist();
  }

  double get overallPercentage {
    final t = _subjects.fold<int>(0, (a, s) => a + s.total);
    final a = _subjects.fold<int>(0, (a, s) => a + s.attended);
    return t == 0 ? 0 : (a / t) * 100;
  }
}
