import { describe, expect, it } from '@jest/globals';
import {
  plainTextTransform,
  stripHtmlTags,
  toPlainText,
} from '../../../src/libs/utils/plain-text.util';

describe('stripHtmlTags / toPlainText', () => {
  it('removes the SEC-04 stored-XSS payloads', () => {
    expect(toPlainText('<img src=x onerror=alert(1)>')).toBe('');
    expect(toPlainText('"><script>alert(2)</script>')).toBe('">');
    expect(toPlainText('<svg/onload=alert(3)>')).toBe('');
    expect(toPlainText('Ravi<img src=x onerror=alert(1)>')).toBe('Ravi');
  });

  it('keeps the text inside harmless elements', () => {
    expect(toPlainText('<b>Ravi</b> <i>Kumar</i>')).toBe('Ravi Kumar');
    expect(toPlainText('12 MG Road<br/>Pune')).toBe('12 MG RoadPune');
  });

  it('drops script and style blocks with their content', () => {
    expect(toPlainText('A<script type="text/javascript">steal()</script>B')).toBe('AB');
    expect(toPlainText('A<style>body{display:none}</style>B')).toBe('AB');
  });

  it('removes comments and unclosed tags', () => {
    expect(toPlainText('Asha<!-- hidden -->')).toBe('Asha');
    expect(toPlainText('Asha <img src=x onerror=alert(1)')).toBe('Asha');
  });

  it('keeps legitimate punctuation and comparison signs', () => {
    expect(toPlainText("D'Souza")).toBe("D'Souza");
    expect(toPlainText("O'Brien & Sons")).toBe("O'Brien & Sons");
    expect(toPlainText('"Shanti" Nivas, Flat #4')).toBe('"Shanti" Nivas, Flat #4');
    expect(toPlainText('I <3 Pune')).toBe('I <3 Pune');
    expect(toPlainText('a < b > c')).toBe('a < b > c');
    expect(toPlainText('5<6')).toBe('5<6');
  });

  it('keeps unicode, Devanagari, RTL scripts and emoji', () => {
    expect(toPlainText('आदेश भुजबळ')).toBe('आदेश भुजबळ');
    expect(toPlainText('محمد علي')).toBe('محمد علي');
    expect(toPlainText('שלום')).toBe('שלום');
    expect(toPlainText('José Müller 🙂')).toBe('José Müller 🙂');
    // RLM / LRM marks used by mixed-direction text are kept.
    expect(toPlainText('abc\u200Fdef\u200E')).toBe('abc\u200Fdef\u200E');
  });

  it('removes bidi override/embedding controls and other control characters', () => {
    expect(toPlainText('Pune\u202Egnp.exe')).toBe('Punegnp.exe');
    expect(toPlainText('a\u202Ab\u202Cc')).toBe('abc');
    expect(toPlainText('a\u0000b\u0007c\u007Fd')).toBe('abcd');
  });

  it('keeps newlines and tabs in stripHtmlTags, normalising CRLF', () => {
    expect(stripHtmlTags('line1\r\nline2\tend')).toBe('line1\nline2\tend');
  });

  it('trims and collapses spaces left by removed tags', () => {
    expect(toPlainText('  Ravi   <b></b>  Kumar  ')).toBe('Ravi Kumar');
  });
});

describe('plainTextTransform', () => {
  it('normalises strings and passes other types through for the validator', () => {
    expect(plainTextTransform({ value: ' <b>Asha</b> ' })).toBe('Asha');
    expect(plainTextTransform({ value: 42 })).toBe(42);
    expect(plainTextTransform({ value: undefined })).toBeUndefined();
    expect(plainTextTransform({ value: null })).toBeNull();
  });
});
