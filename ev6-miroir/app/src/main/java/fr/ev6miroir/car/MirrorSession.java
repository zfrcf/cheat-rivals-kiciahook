package fr.ev6miroir.car;

import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.car.app.Screen;
import androidx.car.app.Session;

public class MirrorSession extends Session {
    @NonNull @Override
    public Screen onCreateScreen(@NonNull Intent intent) {
        return new MirrorScreen(getCarContext());
    }
}
