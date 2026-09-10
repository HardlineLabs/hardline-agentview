package labs.hardline.agentview;

import com.journeyapps.barcodescanner.CaptureActivity;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;
import com.journeyapps.barcodescanner.Size;

/** A portrait, square capture area keeps the whole pairing QR in the decoder crop. */
public class PairingCaptureActivity extends CaptureActivity {
    @Override protected DecoratedBarcodeView initializeContent() {
        DecoratedBarcodeView view = super.initializeContent();
        int side = Math.round(280 * getResources().getDisplayMetrics().density);
        view.getBarcodeView().setFramingRectSize(new Size(side, side));
        return view;
    }
}
