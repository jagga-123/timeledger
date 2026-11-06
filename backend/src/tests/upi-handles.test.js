// The list of common UPI handles and the "did you mean ...?" suggestion live in the frontend (the warning is shown under the UPI ID
// field as it is typed). The module has no dependencies, so the backend's Jest can test it directly, in the one place it is kept.
import { UPI_HANDLES, upiHandleOf, closestUpiHandle, checkUpiHandle, upiHandleWarning } from '../../../frontend/src/utils/upiHandles.js';

describe('the list of common UPI handles', () => {
  it('has every handle that was asked for, once each and in lower case', () => {
    const asked = [
      'okhdfcbank', 'okicici', 'oksbi', 'okaxis', 'ybl', 'ibl', 'axl', 'paytm', 'upi', 'apl', 'yapl', 'fbl', 'idfcbank', 'kotak', 'hdfcbank',
      'icici', 'sbi', 'axisbank', 'pnb', 'barodampay', 'freecharge', 'jupiteraxis', 'waaxis', 'wahdfcbank', 'waicici', 'wasbi', 'ikwik', 'slc', 'airtel', 'postbank',
    ];
    expect([...UPI_HANDLES].sort()).toEqual([...asked].sort());
    expect(new Set(UPI_HANDLES).size).toBe(UPI_HANDLES.length);
    expect(UPI_HANDLES.every((handle) => handle === handle.toLowerCase() && /^[a-z][a-z0-9.]+$/.test(handle))).toBe(true);
  });

  it('can not be changed by accident', () => {
    expect(Object.isFrozen(UPI_HANDLES)).toBe(true);
  });
});

describe('the handle of a UPI ID', () => {
  it('is what follows the @, trimmed and in lower case', () => {
    expect(upiHandleOf('alex@okhdfcbank')).toBe('okhdfcbank');
    expect(upiHandleOf('  Alex.Morgan@OkHDFCBank  ')).toBe('okhdfcbank');
    expect(upiHandleOf('9876543210@paytm')).toBe('paytm');
  });

  it('is empty when there is nothing to look at: the server explains those mistakes itself, so they are not warned about twice', () => {
    for (const upiId of ['', '   ', 'alex', 'alex@', '@okhdfcbank', 'alex@a', 'alex@bank!', 'alex@ok hdfc', undefined, null, 42]) {
      expect([upiId, upiHandleOf(upiId)]).toEqual([upiId, '']);
    }
  });
});

describe('the closest known handle', () => {
  it('suggests the handle a typo was meant to be', () => {
    const typos = {
      okhdfcnk: 'okhdfcbank', // letters missing
      okhdfcbanks: 'okhdfcbank', // a letter too many
      okhfdcbank: 'okhdfcbank', // two letters swapped
      okhdfcbnak: 'okhdfcbank',
      oksbj: 'oksbi', // a wrong letter
      okicic: 'okicici',
      okaxs: 'okaxis',
      ybll: 'ybl',
      yb: 'ybl',
      ylb: 'ybl', // two letters swapped in a short handle: only a swap counts as one edit here
      paytn: 'paytm',
      airtell: 'airtel',
      axisbnk: 'axisbank',
      idfcbnk: 'idfcbank',
      freecharg: 'freecharge',
    };
    for (const [typo, meant] of Object.entries(typos)) expect([typo, closestUpiHandle(typo)]).toEqual([typo, meant]);
  });

  it('is not case sensitive', () => {
    expect(closestUpiHandle('OKHDFCNK')).toBe('okhdfcbank');
  });

  it('suggests nothing when nothing is close: no wild guesses', () => {
    for (const handle of ['mycompany', 'gmail', 'okhdfc', 'bankofsomewhere', 'zzzzzz', 'xq']) {
      expect([handle, closestUpiHandle(handle)]).toEqual([handle, null]);
    }
  });

  it('a handle that is known needs no suggestion of its own: it is its own closest one', () => {
    for (const handle of UPI_HANDLES) expect(closestUpiHandle(handle)).toBe(handle);
  });

  it('on a tie prefers a handle that starts with the same letter, then the one that comes first in the list', () => {
    // "abl" is one letter from "axl", "apl", "ybl", "ibl" and "fbl": those that start with a come first, and axl is before apl in the list
    expect(closestUpiHandle('abl')).toBe('axl');
    // "xbl" is one letter from "ybl", "ibl" and "fbl" and starts like none of them: the first in the list
    expect(closestUpiHandle('xbl')).toBe('ybl');
  });
});

describe('checking an ID', () => {
  it('has nothing to say about a known handle, in any case and with spaces around the ID', () => {
    for (const upiId of ['alex@okhdfcbank', ' ALEX@OKHDFCBANK ', 'alex.morgan@ybl', '9876543210@paytm']) expect([upiId, checkUpiHandle(upiId)]).toEqual([upiId, null]);
    for (const handle of UPI_HANDLES) expect(checkUpiHandle(`name@${handle}`)).toBeNull();
  });

  it('says which handle it does not know, and what was probably meant', () => {
    expect(checkUpiHandle('alex@okhdfcnk')).toEqual({ handle: 'okhdfcnk', suggestion: 'okhdfcbank' });
    expect(checkUpiHandle('Alex@MyCompany')).toEqual({ handle: 'mycompany', suggestion: null });
  });
});

describe('the amber warning under the UPI ID field', () => {
  it('names the handle and suggests the closest known one', () => {
    expect(upiHandleWarning('alex@okhdfcnk')).toBe('We don\'t recognise "@okhdfcnk". Double-check your UPI ID — did you mean @okhdfcbank?');
    expect(upiHandleWarning('  Alex@OKSBJ ')).toBe('We don\'t recognise "@oksbj". Double-check your UPI ID — did you mean @oksbi?');
  });

  it('without a close match it only says to double-check', () => {
    expect(upiHandleWarning('alex@mycompany')).toBe('We don\'t recognise "@mycompany". Double-check your UPI ID.');
  });

  it('is empty for a known handle, for nothing typed yet, and for IDs the server will explain itself', () => {
    for (const upiId of ['alex@okhdfcbank', '', '   ', 'alex', 'alex@', '@okaxis', 'alex@bank!']) expect([upiId, upiHandleWarning(upiId)]).toEqual([upiId, '']);
  });
});
